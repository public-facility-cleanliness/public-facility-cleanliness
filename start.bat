@echo off
title Public Facility Cleanliness Server
echo Starting Public Facility Cleanliness Tracker... keep this window open.
start "" http://localhost:3000
node server.js
pause
