# The automation Chrome

The pack applies, reads Gmail and reads LinkedIn in a Chrome window of its own: a separate Chrome profile kept in your
career-ops data folder (`data/chrome-automation`). Your everyday Chrome profile, bookmarks and tabs are never touched.

## One-time sign-ins

Open it once and sign in yourself to LinkedIn, Gmail and Handshake. The pack never types a password, never creates an
account and never solves a CAPTCHA or "verify you are human" check. When one appears, the job goes on a "finish these
yourself" list with a direct link, and everything else keeps going.

## Open and close

- Open: `node student/scripts/chrome.mjs open`. It prints `chrome: ready <profile path>` and reuses a window that is
  already open.
- Check: `node student/scripts/chrome.mjs status`.
- Close: `node student/scripts/chrome.mjs close`. It stops only the Chrome it started and waits until that Chrome has
  exited.

If `open` says another Chrome holds the profile, an automation Chrome window it did not start is still open (for
example after Chrome restarted itself for an update). Quit that window, then run `open` again.

On a shared or small computer a browser slot command can run first (`browser.slot_cmd` in config/student.yml, or the
`BROWSER_SLOT_CMD` variable). Any non-zero exit from it means wait, and Chrome does not start.

## Where it lives

The profile folder is `data/chrome-automation`; the port and process id of the running window are in
`data/.chrome-automation`, readable only by you. The port only listens on 127.0.0.1.

Next: open the automation Chrome and sign in to LinkedIn, Gmail and Handshake.
Type: open my automation Chrome
Why: every apply, Gmail read and LinkedIn read runs in that window, so the sign-ins happen once and never again.
You can always ask me for more. Just ask and approve.
