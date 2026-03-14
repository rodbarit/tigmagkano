# Tigmagkano 🧾

Receipt parser that extracts food items and exports a formatted Din Tai Fung order breakdown sheet.

---

## Project structure

```
tigmagkano/
├── frontend/
│   └── index.html          ← The app (deployed via AWS Amplify)
├── lambda/
│   └── index.js            ← API proxy (deployed via AWS Lambda)
├── amplify.yml             ← Amplify build config
└── README.md
```

---

## Step 1 — Deploy the Lambda proxy

### 1a. Create the Lambda function

1. Go to **AWS Console → Lambda → Create function**
2. Choose **Author from scratch**
3. Settings:
   - **Function name**: `tigmagkano-proxy`
   - **Runtime**: Node.js 20.x
   - **Architecture**: x86_64
4. Click **Create function**

### 1b. Upload the code

1. In the function's **Code** tab, open `index.js` in the inline editor
2. Delete everything and paste the contents of `lambda/index.js`
3. Click **Deploy**

### 1c. Add your Anthropic API key

1. Go to **Configuration → Environment variables**
2. Click **Edit → Add environment variable**
   - **Key**: `ANTHROPIC_API_KEY`
   - **Value**: your Anthropic API key (starts with `sk-ant-...`)
3. Click **Save**

### 1d. Set the timeout

1. Go to **Configuration → General configuration → Edit**
2. Set **Timeout** to `30 seconds`
3. Save

### 1e. Create an API Gateway

1. Go to **AWS Console → API Gateway → Create API**
2. Choose **HTTP API → Build**
3. Click **Add integration → Lambda** and select `tigmagkano-proxy`
4. **API name**: `tigmagkano-api`
5. Click **Next**
6. Add a route:
   - **Method**: POST
   - **Resource path**: `/parse`
7. Click through to **Create**
8. Go to the API's **Stages** — copy the **Invoke URL** (looks like `https://abc123.execute-api.ap-southeast-1.amazonaws.com/default`)

### 1f. Enable CORS on API Gateway

1. In your API, go to **CORS**
2. Set:
   - **Access-Control-Allow-Origin**: `*`
   - **Access-Control-Allow-Methods**: `POST, OPTIONS`
   - **Access-Control-Allow-Headers**: `Content-Type`
3. Save

---

## Step 2 — Update the frontend with your API URL

Open `frontend/index.html` and find this line near the bottom:

```js
const PROXY_URL = 'https://YOUR_API_GATEWAY_ID.execute-api.YOUR_REGION.amazonaws.com/prod/parse';
```

Replace it with your actual API Gateway invoke URL + `/parse`, for example:

```js
const PROXY_URL = 'https://abc123.execute-api.ap-southeast-1.amazonaws.com/default/parse';
```

---

## Step 3 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/tigmagkano.git
git push -u origin main
```

---

## Step 4 — Deploy frontend with AWS Amplify

1. Go to **AWS Console → Amplify → Create new app**
2. Choose **GitHub** and connect your account
3. Select the `tigmagkano` repo and `main` branch
4. On the build settings page, Amplify will auto-detect `amplify.yml`
5. Click **Save and deploy**
6. Once done, Amplify gives you a live URL like `https://main.abc123.amplifyapp.com`

> Every time you push to `main`, Amplify will auto-redeploy.

---

## Optional — Custom domain

In Amplify → your app → **Domain management**, you can attach a custom domain (e.g. `tigmagkano.com`).

---

## Local development

Just open `frontend/index.html` directly in your browser. Note that the `PROXY_URL` must be set to your deployed Lambda URL for parsing to work — there's no local backend.
