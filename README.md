# TrackAlign

HGV Wheel Alignment PWA for AES Workshop.

## Local development

```bash
npm install
npm run dev
```

Opens at http://localhost:5173

## Deploy to Vercel

1. Push this folder to a GitHub repository
2. Go to vercel.com → New Project → Import your GitHub repo
3. Vercel auto-detects Vite — just click Deploy
4. Done. You get a live URL instantly.

## Custom domain

In Vercel project settings → Domains → Add your domain.
Point your DNS A record to Vercel's IP (shown in their UI).
SSL is automatic.

## PWA / Add to Home Screen

Once live, open on iPhone Safari → Share → Add to Home Screen.
The app installs as a standalone app with no browser chrome.

## Icons

Add `icon-192.png` and `icon-512.png` to the `/public` folder
(192×192 and 512×512 PNG, your logo) for the home screen icon.
