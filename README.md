# CareFlow AI — Multi-Hospital Post-Discharge Outreach Platform

Prototype implementation based on the supplied PRD. It demonstrates multi-tenancy, hospital-specific campaigns/questions/protocols, eligibility, prioritized outreach queue, SendGrid email outreach, secure expiring patient links, text/voice responses, Cloudinary/private audio storage, Gemini structured AI assessment, deterministic safety validation, consensus, human escalation, mock EHR, audit logs, and dashboard metrics.

## Stack
- Backend: Node.js, Express, MongoDB/Mongoose, JWT, Multer, node-cron
- AI: Google Gemini via `@google/genai`
- Email: SendGrid
- Audio: Cloudinary (or local storage for development)
- Frontend: React + Vite

## Important prototype safety boundary
Gemini never writes to MongoDB directly. Its output is schema-validated, checked for completeness, checked against hospital protocol triggers, checked against deterministic safety rules, and passed through consensus/business rules before an authorized backend service can update the mock EHR. Ambiguous, conflicting, incomplete, or unsafe cases go to human review.

Use synthetic patient/health data for demos. Use real email inboxes only where you have permission.

## 1. Backend
```bash
cd backend
npm install
cp .env.example .env
# fill MONGODB_URI and GEMINI_API_KEY; SendGrid/Cloudinary are optional for local demo
npm run seed
npm run dev
```

Backend: http://localhost:4000

## 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173

## Demo users
Password for all seeded users: `demo123`
- Platform Admin: `platform@careflow.local`
- Hospital A Admin: `admin@hospital-a.local`
- Hospital A Manager: `manager@hospital-a.local`
- Hospital A Reviewer: `reviewer@hospital-a.local`
- Hospital B Admin: `admin@hospital-b.local`

The seed creates synthetic patients with placeholder emails. Replace them with test inboxes you control before testing SendGrid.

## Environment
See `backend/.env.example`.

## Patient flow
1. Hospital admin imports/creates discharged patients.
2. Campaign manager creates/uses a campaign with hospital-specific questions.
3. Eligibility endpoint finds eligible patients.
4. Queue worker creates outreach tasks and calculates priority.
5. Send outreach email with a random expiring token.
6. Patient opens `/patient/followup/:token` and answers every required question using text OR voice.
7. Backend verifies all required questions are answered before final submission.
8. Voice files are stored privately in Cloudinary (local fallback available) and passed to Gemini.
9. Gemini produces structured assessment(s).
10. Backend performs validation + deterministic protocol/safety checks + consensus.
11. Escalated cases become human-review records.
12. Safe routine cases are documented and can update the mock EHR through a controlled backend path.

## API highlights
- `POST /api/auth/login`
- `GET /api/hospitals`
- `POST /api/patients`
- `POST /api/campaigns`
- `POST /api/campaigns/:id/eligibility/run`
- `POST /api/queue/process`
- `GET /api/queue`
- `POST /api/patient/outreach/:token/response`
- `POST /api/patient/outreach/:token/submit`
- `GET /api/reviews`
- `POST /api/reviews/:id/resolve`
- `GET /api/dashboard/summary`
