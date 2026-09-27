backendcamera-sensor.py accepts a normal Windows webcam index through
--source. If an AndroidiPhone is exposed to Windows as a webcam by a
USB cameravirtual-webcam application, use the corresponding camera index.

Connect the phone to the PC with USB.

Enable the phone's webcamUSB-camera mode or start the USB virtual-webcam application.

Find the camera index. Start with --source 0, then try 1, 2, etc.

Run CrowdPulse with the selected index.

Example

cd CUserstanisDesktoptanishqcodingcrowdpulse-fixed-inprogressuploaded_checkbackend
python camera-sensor.py --zone A --source 1 --show

The optimized sensor defaults to 640x480 capture and 640 YOLO inference size.
YOLO still sends a sensor reading every 2 seconds by default, while the
preview window refreshes continuously.

If the phone is not exposed to Windows as a camera device, the script cannot
open it merely because it is connected over USB; Windows must expose a
webcamvirtual-camera device first.q