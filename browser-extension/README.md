# Cyraops Browser Agent (dev)

Lets the assistant work in a browser tab **on the user's own computer**, instead
of a server that costs money every hour and cannot see their signed-in sessions.

## Install (unpacked, for dev)

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → choose this `browser-extension` folder
4. Open the CRM (`http://127.0.0.1:3001/ai`), open the right rail and turn on
   **Use my browser**

## What it can do

`navigate`, `click`, `type`, `extract`, `screenshot` — each performed with the
DevTools Protocol in a tab the extension owns, so the tab the person is working
in is never navigated away from.

## What it cannot do

It sees only its own tab. It does not read your other tabs, your history or your
passwords, and turning the toggle off in the CRM stops all traffic immediately.
