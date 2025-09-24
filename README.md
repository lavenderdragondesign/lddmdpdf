
# OG AlternativeDownloadLinkPleaseRead — Inject Link from MD Download.pdf

- Drop/select your original MyDesigns **Download.pdf**.
- The app extracts the first embedded **URI**.
- It loads the **exact OG AlternativeDownloadLinkPleaseRead.pdf** (bundled in `public/`) and injects that URL into its link annotations.
- Saves the **unchanged design** as `AlternativeDownloadLinkPleaseRead.pdf` to your chosen folder.
- Remembers your folder, removes numbered duplicates, supports overwrite mode.

## Run
```bash
npm i
npm run dev
```

Use Chrome/Edge for direct folder saving. If not available, a normal browser download is used.


## Template & Quick Save
- **Upload Template PDF** to use your own layout, or click **Use OG Template** to revert.
- After you drop/select a **Download.pdf**, click **Save as AlternativeDownloadLinkPleaseRead.pdf** to regenerate instantly using the last extracted link.
