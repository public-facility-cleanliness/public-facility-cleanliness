Public Facility Cleanliness Tracker

EASIEST WAY (no black window): double-click index.html. Data is saved in your browser only.
BACKEND WAY (shared data, Node.js): double-click start.bat (or run: node server.js) and open http://localhost:3000

LOGIN
- User: mobile number + OTP (the OTP is shown on the page - demo).
- Admin: ID = admin, Password = admin123.

PHOTO: put the Prime Minister's official photo in this folder as pm.jpg (next to index.html).

SEE REPORTS FROM ALL DEVICES (admin sees everyone's forms)
1. Double-click start.bat on the laptop (keep the black window open).
2. The window prints a line like: Open from a phone or another laptop on the same WiFi: http://192.168.1.5:3000
3. Users open that link on their phones (same WiFi) and fill the form.
4. Admin logs in on the laptop at http://localhost:3000 and sees every report.
For internet access from anywhere use a free tunnel (ngrok: ngrok http 3000) or host server.js on Render/Railway.
