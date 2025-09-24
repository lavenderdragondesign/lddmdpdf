
# MD PDF Link Rewriter — Auto-extract + Persisted Desktop + Coords Targeting

**What it does**
- Drag/drop or select your original MyDesigns **Download.pdf**.
- Auto-extracts the first embedded **URI**.
- Rewrites **only** the button/link area you specify by **coords** (X,Y,W,H in PDF points). If no coords, it targets the **largest existing link**.
- Saves to your chosen folder (e.g., **Desktop**) as **AlternativeDownloadLinkPleaseRead.pdf**.
- Removes numbered duplicates like `AlternativeDownloadLinkPleaseRead (1).pdf`.
- **Remembers** your chosen folder using IndexedDB (Chrome/Edge).

**One‑click Overwrite**
- Toggle **Overwrite instantly** to write without extra prompts.

## Run
```bash
npm i
npm run dev
```

1. Click **Choose Save Folder** (pick Desktop). Enable **Remember folder** if you want it persisted.
2. (Optional) Enter **X,Y,W,H** to target only the button region; otherwise the largest link gets rewritten.
3. Drag & drop or **Select PDF** for your **Download.pdf**.
4. The app writes **AlternativeDownloadLinkPleaseRead.pdf** to your folder.

## Notes
- Folder persistence requires Chromium-based browsers and permission grants.
- Coords are in PDF points (origin bottom-left). If unsure, leave blank to use the largest link.
- If the input PDF has no link annotations, the app adds a small invisible link at the top-left of page 1.


## Deploy to Netlify
1. Push this repo to GitHub (branch: `main`).
2. In Netlify: **Add new site → Import from Git** → choose this repo.
3. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Node version: `20`
4. Deploy. Netlify serves over HTTPS (required by the File System Access API).

The included `netlify.toml` and `public/_redirects` handle SPA routing and headers.
