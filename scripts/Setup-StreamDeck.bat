@echo off
title Stream Deck DCS Setup
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0setup-streamdeck.ps1" %*
