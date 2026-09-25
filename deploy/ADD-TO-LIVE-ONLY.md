# Add Capture thread without replacing the live app

The public Contextboard at `https://contextboard-web.onrender.com` is your current app (MM tokens, exercises, `contextboard-api2`). This repository’s `web/` app is a smaller board. Do **not** point the live `contextboard-web` service at `web/` or `dist` from this repo. That would replace months of work.

## What to add

Keep the live frontend’s existing `index.html` and JavaScript. Add only:

1. The file `deploy/live-with-thread/thread-capture.js` next to the live site’s other static files.
2. This one line before `</body>` in the live `index.html`:

```html
<script src="/thread-capture.js"></script>
```

Then deploy **that same frontend** the way you already deploy it.

The blue **Capture thread** button appears in the top-left. The rest of the app stays as it is.

## Rollback to the start of the day

`rollback/start-of-day-live/` is a copy of the live site from 25 Sep 2026, before this button.

```
./rollback/restore-start-of-day-live.sh
```

Or remove the script tag and `thread-capture.js` from the live frontend and deploy again.
