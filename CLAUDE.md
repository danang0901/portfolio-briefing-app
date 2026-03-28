## Deploy Configuration (configured by /setup-deploy)
- Platform: Vercel
- Production URL: https://portfolio-briefing-app.vercel.app
- Deploy workflow: auto-deploy on push (GitHub connected)
- Deploy status command: HTTP health check
- Merge method: merge
- Project type: web app (Next.js)
- Post-deploy health check: https://portfolio-briefing-app.vercel.app

### Custom deploy hooks
- Pre-merge: none
- Deploy trigger: automatic on push to main
- Deploy status: poll production URL
- Health check: https://portfolio-briefing-app.vercel.app
