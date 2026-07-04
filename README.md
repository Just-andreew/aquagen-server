# AquaGen Server

AquaGen Server is the backend infrastructure for the AquaGen Farm operations system. It orchestrates communication between automated IoT hardware (ESP32 feeders) and a smart Telegram Bot interface used by field technicians and administrators. The system is built on Node.js/Express, uses Firebase Firestore for data storage and RBAC, and integrates the Gemini AI API for intelligent operational triage.

## System Architecture

The architecture is designed for serverless environments (like Vercel) and handles two primary domains:

1.  **IoT Telemetry & Control (`/routes/iot.js`)**:
    *   Communicates with automated fish feeders (ESP32 devices).
    *   Provides short-polling endpoints for manual feed triggers.
    *   Ingests telemetry data (dispensed feed, battery voltage) securely using a hardware secret.

2.  **Telegram Bot Webhook (`/routes/telgram.js`)**:
    *   Serves as the primary operational interface for farm staff.
    *   **Triage Engine**: Uses **Gemini 3.5 Flash** (via `triage.js`) to analyze natural language messages and uploaded images, automatically categorizing operations (Feeding, Mortality, Water Quality, etc.) and extracting structured metrics into Firestore.
    *   **Role-Based Access Control (RBAC)**: Validates Telegram user IDs against a Firestore database to assign tiers (`super-admin`, `technician`), controlling access to sensitive operations (e.g., Financial reporting).
    *   **Interactive Menu**: Provides an inline keyboard interface for quick operations (Log Sale, Scan Receipt, Report Mortalities).

## Environment Variables

The server requires the following environment variables to function properly:

| Variable | Description |
| :--- | :--- |
| `FIREBASE_PROJECT_ID` | Firebase project identifier. |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account client email. |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key (newline literals `\n` are parsed). |
| `IOT_SECRET_KEY` | Secret key used to authorize payloads from ESP32 hardware. |
| `TELEGRAM_BOT_TOKEN` | Token provided by BotFather for the Telegram Bot. |
| `GEMINI_API_KEY` | API key for Google Generative AI (Gemini). |
| `PORT` | Local development port (defaults to 3000 if not in production). |

## API Reference

### IoT Endpoints

#### `GET /feederPing`
Short-polling endpoint for ESP32 devices to check for manual feed triggers.
*   **Query Params**: `device_id` (string, required)
*   **Response**: `{ drop: boolean, grams?: number }`

#### `POST /iotLog`
Endpoint for hardware to report successful feeding events and telemetry.
*   **Headers**: `x-iot-secret` (must match `IOT_SECRET_KEY`)
*   **Body**: `{ device_id, pond_tag, grams_dispensed, event_type, v_batt }`
*   **Response**: `{ success: boolean }`

### Telegram Endpoint

#### `POST /telegramWebhook`
Master dispatcher for incoming Telegram updates.
*   **Behavior**:
    1.  Intercepts inline keyboard callbacks (via `menu.js`).
    2.  Handles explicit commands (`/menu`, `/admin`, `/start`).
    3.  Passes unstructured text and images to the AI Triage engine (`triage.js`).

## Core Modules & Middlewares

*   **`controllers/triage.js`**: The intelligence hub. Uses the `gemini-3-flash-preview` model to parse text and images, extracting JSON metrics (event type, ponds, feed amount, confidence score) and saving them to the `logs` collection in Firestore. It includes a 3-minute temporal buffer to combine related messages (e.g., an image followed immediately by a text caption).
*   **`controllers/menu.js`**: Manages the interactive Telegram UI, adapting options based on the user's RBAC tier.
*   **`middlewares/rbac.js`**: Fetches user clearance from the `authorized_users` Firestore collection, defaulting unknown users to the safe `technician` tier.
*   **`middlewares/auditStamper.js`**: Attaches immutable tracking metadata (name, Telegram ID, timestamp, source channel) to all requests before they hit the database logic.
*   **Scaffolded Controllers**: Features like `accounting.js` (OCR, Sales) and `biological.js` (Mortality) are scaffolded and ready for future implementation.

## Deployment

This server is configured for deployment on **Vercel** as a serverless function.
*   The `vercel.json` file is pre-configured.
*   The Express app is exported in `server.js` (`module.exports = app;`) as required by Vercel's serverless runtime.
*   The root route `/` acts as a health check to prevent 404s when visiting the deployment URL.

To run locally:
```bash
npm install
npm start
```
