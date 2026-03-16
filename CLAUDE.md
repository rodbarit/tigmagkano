# tig-magkano

A receipt splitter PWA for group dining (primarily Din Tai Fung, Philippines). Scan a receipt → share a link → everyone logs what they ordered → see who owes what.

## What it does

1. **index.html** — Organizer uploads a receipt photo → Claude AI parses items → review/edit → generate shareable link or copy table to Google Sheets template
2. **order.html** — Recipients open the shared link → enter name → tap +/- for each item they ordered → live summary shows each person's total to pay

## Stack

- Pure HTML/CSS/JS (no framework, no build step)
- AWS Lambda (Node.js) as API proxy — forwards receipt image to Claude API for parsing
- AWS API Gateway — exposes the Lambda as HTTP endpoints
- AWS DynamoDB — stores shared orders
- AWS Amplify — hosts the frontend (auto-deploys on push to `main`)

## Project structure

```
frontend/
  index.html        ← Main app (upload + parse + share)
  order.html        ← Order-splitting page (shared link destination)
  manifest.json     ← PWA manifest
  service-worker.js ← PWA offline support
  icon-192.png
  icon-512.png
lambda/
  index.js          ← API proxy (parse receipt + CRUD orders)
lambda-orders/      ← Separate Lambda for order storage (DynamoDB)
amplify.yml         ← Amplify build config
```

## API endpoints (both in frontend JS as PROXY_URL / ORDERS_URL)

- `POST /parse` — receives base64 image, calls Claude, returns parsed items + discounts
- `POST /order` — creates a new shared order in DynamoDB, returns orderId
- `GET /order/:id` — fetches an order by ID
- `PUT /order/:id` — updates a participant's item assignments

## Key UX context

- Target users are Filipino diners splitting a bill at the table, mostly on mobile
- Currency is ₱ (Philippine Peso)
- Receipt fields: items, service charge, VAT adjustment, SC discount, PWD discount
- The app is a PWA — installable on iPhone and Android
- Discount items (VAT, SC, PWD) are tracked per-person on order.html

## UI/UX rule

**Always design and review for mobile first.** Users are at a restaurant, on their phones, often one-handed. Every change should be checked against:
- Touch targets minimum 44px
- No horizontal scroll on small screens
- Key actions visible without scrolling
- Readable font sizes (minimum 12px, ideally 14px for body)

## Known UX issues (as of March 2026)

- No onboarding or context for first-time users on both pages
- No dedicated camera button on mobile (file picker only)
- Share button buried below optional section on index.html
- Discount items confusing for order.html recipients
- `downloadXlsx()` function exists in index.html but has no button wired to it
- Post-save messaging on order.html is minimal

## Branch strategy

- `main` — production (triggers Amplify deploy)
- `staging` — active development branch
