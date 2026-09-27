"""CrowdPulse: smooth webcam preview and tracked boxes, periodic YOLO and sensor posts.

YOLO runs in a worker thread. Between detections, Lucas-Kanade optical flow
moves each box using feature points inside it. This is visual tracking, not
new person detection: counts are updated only by YOLO.
"""
import argparse
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request

import cv2
import numpy as np
from ultralytics import YOLO

PERSON_CLASS_ID = 0


def parse_args():
    p = argparse.ArgumentParser(description="CrowdPulse smooth camera sensor")
    p.add_argument("--zone", required=True)
    p.add_argument("--source", default="0", help="Webcam index or IP camera URL")
    p.add_argument("--backend", default=os.getenv("BACKEND_URL", "http://localhost:4000"))
    p.add_argument("--interval", type=float, default=2.0, help="Seconds between backend updates")
    p.add_argument("--detect-interval", type=float, default=0.5, help="Minimum seconds between YOLO runs")
    p.add_argument("--model", default=os.getenv("YOLO_MODEL", "yolov8n.pt"))
    p.add_argument("--conf", type=float, default=0.35)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--width", type=int, default=640)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--show", action="store_true")
    p.add_argument("--username", default=os.getenv("SENSOR_USERNAME", "sensor"))
    p.add_argument("--password", default=os.getenv("SENSOR_PASSWORD", "crowdpulse-sensor"))
    return p.parse_args()


def http_json(url, payload, token=None, timeout=5):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return resp.status, json.loads(raw) if raw else {}


def login(args):
    status, data = http_json(args.backend.rstrip("/") + "/api/auth/login", {
        "username": args.username, "password": args.password
    })
    if status != 200 or not data.get("token"):
        raise RuntimeError(f"Sensor login failed: HTTP {status}")
    return data["token"]


def send_count(args, count, token):
    url = args.backend.rstrip("/") + "/api/sensor-ping"
    payload = {"zoneId": args.zone, "count": int(count), "source": "camera-cv"}
    try:
        status, _ = http_json(url, payload, token)
        return status == 200, token
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            try:
                token = login(args)
                status, _ = http_json(url, payload, token)
                return status == 200, token
            except Exception as refresh_exc:
                print(f"[camera-cv] token refresh failed: {refresh_exc}", file=sys.stderr)
                return False, token
        print(f"[camera-cv] backend HTTP {exc.code}", file=sys.stderr)
        return False, token
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"[camera-cv] backend unavailable: {exc}", file=sys.stderr)
        return False, token


def camera(source, width, height):
    try:
        cap = cv2.VideoCapture(int(source), cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY)
    except ValueError:
        cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open camera: {source}")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Not all drivers support this.
    return cap


def feature_points(gray, box):
    h, w = gray.shape
    x1, y1, x2, y2 = [int(v) for v in box]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 - x1 < 8 or y2 - y1 < 8:
        return None
    roi = gray[y1:y2, x1:x2]
    pts = cv2.goodFeaturesToTrack(roi, maxCorners=24, qualityLevel=0.015, minDistance=5)
    if pts is None:
        return None
    pts[:, :, 0] += x1
    pts[:, :, 1] += y1
    return pts


def clamp_box(box, w, h):
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    x1 = min(max(x1, 0), max(0, w - bw))
    y1 = min(max(y1, 0), max(0, h - bh))
    return [x1, y1, x1 + bw, y1 + bh]


def main():
    args = parse_args()
    if args.interval <= 0 or args.detect_interval <= 0 or args.width <= 0 or args.height <= 0:
        raise SystemExit("Intervals, width and height must be positive")
    cap = camera(args.source, args.width, args.height)
    print(f"Loading {args.model} ...")
    model = YOLO(args.model)
    token = login(args)
    print(f"[camera-cv] zone={args.zone} camera={args.source} "
          f"capture={args.width}x{args.height} detect={args.detect_interval}s post={args.interval}s")

    lock = threading.Lock()
    stop = threading.Event()
    latest_frame = None
    latest_seq = 0
    result_seq = -1
    result_boxes = []
    result_count = 0
    result_version = 0
    worker_error = None

    def inference_worker():
        nonlocal result_seq, result_boxes, result_count, result_version, worker_error
        last_detection = -float("inf")
        last_post = -float("inf")
        while not stop.is_set():
            with lock:
                frame = None if latest_frame is None else latest_frame.copy()
                seq = latest_seq
            now = time.monotonic()
            if frame is None or seq == result_seq or now - last_detection < args.detect_interval:
                stop.wait(0.01)
                continue
            try:
                # Explicit resize: camera drivers may ignore CAP_PROP_FRAME_WIDTH/HEIGHT.
                small = cv2.resize(frame, (args.width, args.height), interpolation=cv2.INTER_AREA)
                prediction = model(small, classes=[PERSON_CLASS_ID], conf=args.conf,
                                   imgsz=args.imgsz, verbose=False)[0]
                raw = prediction.boxes.xyxy.cpu().numpy() if prediction.boxes is not None else np.empty((0, 4))
                sx, sy = frame.shape[1] / args.width, frame.shape[0] / args.height
                boxes = [[float(x1 * sx), float(y1 * sy), float(x2 * sx), float(y2 * sy)]
                         for x1, y1, x2, y2 in raw]
                count = len(boxes)
                with lock:
                    result_seq = seq
                    result_boxes = boxes
                    result_count = count
                    result_version += 1
                last_detection = time.monotonic()
                if last_detection - last_post >= args.interval:
                    sent, new_token = send_count(args, count, token_holder[0])
                    token_holder[0] = new_token
                    print(f'[camera-cv] zone {args.zone}: {count} people '
                          f'({"sent" if sent else "SEND FAILED"})')
                    last_post = time.monotonic()
            except Exception as exc:
                worker_error = str(exc)
                print(f"[camera-cv] detection error: {exc}", file=sys.stderr)
                stop.wait(0.3)

    token_holder = [token]
    worker = threading.Thread(target=inference_worker, name="crowdpulse-yolo", daemon=True)
    worker.start()
    boxes = []
    points = []
    prev_gray = None
    applied_version = -1
    count = 0
    try:
        while not stop.is_set():
            ok, frame = cap.read()
            if not ok:
                print("[camera-cv] frame read failed", file=sys.stderr)
                stop.wait(0.1)
                continue
            # Keep the preview frame small even if the camera ignores capture settings.
            frame = cv2.resize(frame, (args.width, args.height), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            with lock:
                latest_frame = frame.copy()
                latest_seq += 1
                version = result_version
                new_boxes = [b[:] for b in result_boxes] if version != applied_version else None
                new_count = result_count

            if new_boxes is not None:
                boxes = new_boxes
                points = [feature_points(gray, box) for box in boxes]
                count = new_count
                applied_version = version
            elif prev_gray is not None:
                for i, pts in enumerate(points):
                    if pts is None or len(pts) < 3:
                        points[i] = feature_points(gray, boxes[i])
                        continue
                    moved, status, _ = cv2.calcOpticalFlowPyrLK(prev_gray, gray, pts, None,
                                                               winSize=(21, 21), maxLevel=2)
                    if moved is None or status is None:
                        points[i] = feature_points(gray, boxes[i])
                        continue
                    good = status.ravel() == 1
                    if np.count_nonzero(good) < 3:
                        points[i] = feature_points(gray, boxes[i])
                        continue
                    delta = np.median((moved[good] - pts[good]).reshape(-1, 2), axis=0)
                    dx, dy = float(delta[0]), float(delta[1])
                    # Reject implausibly large optical-flow jumps.
                    if abs(dx) < args.width * 0.12 and abs(dy) < args.height * 0.12:
                        boxes[i] = clamp_box([boxes[i][0] + dx, boxes[i][1] + dy,
                                              boxes[i][2] + dx, boxes[i][3] + dy],
                                             args.width, args.height)
                        points[i] = moved[good].reshape(-1, 1, 2)
                    else:
                        points[i] = feature_points(gray, boxes[i])
            prev_gray = gray

            if args.show:
                for x1, y1, x2, y2 in boxes:
                    cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                cv2.putText(frame, f"People: {count} | q: quit", (10, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                cv2.imshow("CrowdPulse | smooth tracked boxes", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        cap.release()
        if args.show:
            cv2.destroyAllWindows()
        worker.join(timeout=2)


if __name__ == "__main__":
    main()
