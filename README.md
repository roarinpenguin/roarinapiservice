# Simple Token-Protected API

A lightweight Express.js API with a fixed bearer token for authentication, designed to be deployed on [Render.com](https://render.com)... or anywhere else you can run Node.js :)

## Endpoints

| Method | Endpoint    | Auth Required | Description                     |
|--------|-------------|---------------|---------------------------------|
| GET    | /ping       | ❌            | Health check                    |
| GET    | /carlist    | ✅            | Returns a list of cars          |
| POST   | /submit     | ✅            | Accepts and returns JSON        |
| GET    | /status     | ❌            | Returns API status              |
| POST   | /echo       | ✅            | Echoes back posted JSON         |

## Authentication

Use a fixed bearer token:


