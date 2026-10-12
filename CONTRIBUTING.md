# Contributing to CrowdPulse

Thanks for helping improve CrowdPulse. The project is a prototype for crowd monitoring and incident response, so changes should favor correctness, clear failure handling, and honest presentation of simulated or model-generated data.

## Before making a change

1. Create a focused branch from `main`.
2. Keep changes small and explain the user-visible or operational impact in the pull request.
3. Never commit secrets, real environment files, production data, attendee information, or uploaded media.
4. Preserve the existing PostgreSQL database and API contracts unless a change explicitly requires a migration.

## Local development

### Backend

- Use Node.js 18 or newer and PostgreSQL.
- Install dependencies from `backend/` with `npm install`.
- Copy `backend/.env.example` to `backend/.env` and configure local credentials.
- Start the API with `npm start`.
- Run the simulator separately with `npm run simulate` when synthetic readings are needed.

### Frontend

- Install dependencies from `frontend/` with `npm install`.
- Start Vite with `npm run dev`.
- If changing the dashboard served by the backend, ensure the generated frontend bundle in `backend/public/` is refreshed using the repository's build workflow.

### Python AI service

- Install the packages in `ai-service/requirements.txt` in a compatible Python environment.
- Run the AI service's smoke tests with `python ai-service/test_app.py`.
- Keep model artifact and runtime dependency versions aligned. Investigate serialization/version warnings rather than silently ignoring them.

## Verification checklist

Before opening a pull request, run the checks relevant to your change:

- Frontend: `npm run build` from `frontend/`.
- Backend syntax: `node --check backend/server.js`, plus checks for any other JavaScript files changed.
- CCTV pipeline: `node backend/cctv-pipeline.test.js`.
- AI service: `python -m py_compile ai-service/app.py ai-service/test_app.py` and `python ai-service/test_app.py`.

GitHub Actions runs the repository's frontend, backend, and AI-service checks on pushes and pull requests to `main`.

## Data, safety, and deployment

- Clearly identify simulator output as synthetic; never label it as a live observation.
- Treat camera counts and AI predictions as fallible estimates, not as the sole basis for emergency decisions.
- Keep credentials in deployment environment variables, not source control.
- Do not remove the remaining legacy Dockerfiles or retire existing services until the native deployment has been smoke-tested and traffic has been deliberately migrated.
- Do not replace or recreate the existing PostgreSQL database as part of routine deployment work.
- Avoid introducing Redis or another shared event bus unless multi-instance deployment actually requires it and the architecture is updated intentionally.

## Pull requests

A good pull request includes:

- What changed and why.
- How the change was verified.
- Any environment variables, database migrations, or deployment steps required.
- Known limitations or follow-up work.
