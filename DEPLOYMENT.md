# Deployment Guide

## GitHub Pages Deployment

This project is configured to automatically deploy to GitHub Pages when you push to the `main` branch.

### Setup Steps

1. **Enable GitHub Pages in your repository:**
   - Go to your repository on GitHub: https://github.com/ciach/miniature-umbrella
   - Navigate to **Settings** → **Pages**
   - Under "Build and deployment", set:
     - **Source**: GitHub Actions
   - Save the settings

2. **Push your changes:**
   ```bash
   git add .
   git commit -m "Add GitHub Pages deployment"
   git push origin main
   ```

3. **Wait for deployment:**
   - Go to the **Actions** tab in your repository
   - Watch the "Deploy to GitHub Pages" workflow run
   - Once complete, your site will be live at:
     **https://ciach.github.io/miniature-umbrella/**

### Manual Deployment (Alternative)

If you prefer manual deployment using gh-pages:

1. Install gh-pages:
   ```bash
   npm install --save-dev gh-pages
   ```

2. Deploy:
   ```bash
   npm run deploy
   ```

### Troubleshooting

- **404 Error**: Make sure GitHub Pages is enabled and set to use GitHub Actions
- **Blank Page**: Check the browser console for errors. Ensure the `base` path in `vite.config.ts` matches your repository name
- **Build Fails**: Check the Actions tab for error logs

### Local Testing

To test the production build locally:
```bash
npm run build
npm run preview
```

This will serve the built files at http://localhost:4173
