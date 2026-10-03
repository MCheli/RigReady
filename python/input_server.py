#!/usr/bin/env python3
"""
DirectInput server using pygame/SDL.
Communicates via stdin/stdout using newline-delimited JSON.

This provides input data the same way games see it - through DirectInput.
"""

import json
import sys
import time
import threading
import queue

# Disable pygame welcome message
import os
os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'

import pygame

# Configuration
POLL_INTERVAL_MS = 50  # 20 FPS
AXIS_DEADZONE = 0.01   # Ignore tiny axis movements
DEVICE_CHANGE_DEBOUNCE_MS = 2000  # Debounce device changes

# Global state
running = True
command_queue = queue.Queue()
joysticks = {}  # index -> Joystick object
previous_states = {}  # index -> state dict
last_device_change_time = 0
last_device_count = -1


def send_message(msg_type: str, data: dict):
    """Send a JSON message to stdout."""
    message = {"type": msg_type, **data}
    try:
        print(json.dumps(message), flush=True)
    except Exception as e:
        sys.stderr.write(f"Error sending message: {e}\n")
        sys.stderr.flush()


def get_device_info(index: int, joystick: pygame.joystick.JoystickType) -> dict:
    """Get device information."""
    # Try to get GUID (SDL2 feature)
    guid = ""
    try:
        guid = joystick.get_guid()
    except:
        pass

    return {
        "index": index,
        "name": joystick.get_name(),
        "guid": guid,
        "numAxes": joystick.get_numaxes(),
        "numButtons": joystick.get_numbuttons(),
        "numHats": joystick.get_numhats(),
    }


def get_input_state(index: int, joystick: pygame.joystick.JoystickType) -> dict:
    """Get current input state for a joystick."""
    axes = []
    for i in range(joystick.get_numaxes()):
        value = joystick.get_axis(i)
        # Apply deadzone
        if abs(value) < AXIS_DEADZONE:
            value = 0.0
        axes.append(round(value, 4))

    buttons = []
    for i in range(joystick.get_numbuttons()):
        buttons.append(joystick.get_button(i) == 1)

    hats = []
    for i in range(joystick.get_numhats()):
        hat = joystick.get_hat(i)
        hats.append([hat[0], hat[1]])

    return {
        "index": index,
        "name": joystick.get_name(),
        "axes": axes,
        "buttons": buttons,
        "hats": hats,
        "timestamp": int(time.time() * 1000)
    }


def init_joysticks():
    """Initialize all connected joysticks."""
    global joysticks, previous_states

    pygame.joystick.quit()
    pygame.joystick.init()

    joysticks.clear()
    previous_states.clear()

    count = pygame.joystick.get_count()
    devices = []

    for i in range(count):
        try:
            js = pygame.joystick.Joystick(i)
            js.init()
            joysticks[i] = js
            devices.append(get_device_info(i, js))
            previous_states[i] = None
        except Exception as e:
            sys.stderr.write(f"Error initializing joystick {i}: {e}\n")
            sys.stderr.flush()

    return devices


def has_state_changed(index: int, new_state: dict) -> bool:
    """Check if state has changed from previous."""
    prev = previous_states.get(index)
    if prev is None:
        return True

    # Check axes (with tolerance)
    for i, (old, new) in enumerate(zip(prev.get("axes", []), new_state.get("axes", []))):
        if abs(old - new) > AXIS_DEADZONE:
            return True

    # Check buttons
    if prev.get("buttons") != new_state.get("buttons"):
        return True

    # Check hats
    if prev.get("hats") != new_state.get("hats"):
        return True

    return False


def read_commands():
    """Read commands from stdin in a separate thread."""
    global running

    while running:
        try:
            line = sys.stdin.readline()
            if not line:
                # EOF - parent process closed stdin
                running = False
                break

            line = line.strip()
            if line:
                try:
                    cmd = json.loads(line)
                    command_queue.put(cmd)
                except json.JSONDecodeError as e:
                    sys.stderr.write(f"Invalid JSON command: {e}\n")
                    sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"Error reading stdin: {e}\n")
            sys.stderr.flush()
            running = False
            break


def process_command(cmd: dict):
    """Process a command from the main process."""
    cmd_type = cmd.get("command")

    if cmd_type == "enumerate":
        devices = init_joysticks()
        send_message("devices", {"devices": devices})

    elif cmd_type == "stop":
        global running
        running = False

    elif cmd_type == "ping":
        send_message("pong", {"timestamp": int(time.time() * 1000)})

    else:
        sys.stderr.write(f"Unknown command: {cmd_type}\n")
        sys.stderr.flush()


def main():
    global running, previous_states

    # Initialize pygame
    pygame.init()

    # Send ready message
    devices = init_joysticks()
    send_message("ready", {
        "version": pygame.version.ver,
        "deviceCount": len(devices),
        "devices": devices
    })

    # Start command reader thread
    cmd_thread = threading.Thread(target=read_commands, daemon=True)
    cmd_thread.start()

    last_poll = 0

    try:
        while running:
            # Process pygame events (required for joystick updates)
            # We debounce device add/remove to avoid spam
            device_event_pending = False
            for event in pygame.event.get():
                if event.type == pygame.JOYDEVICEADDED or event.type == pygame.JOYDEVICEREMOVED:
                    device_event_pending = True

            # Handle device changes with debouncing
            if device_event_pending:
                global last_device_change_time, last_device_count
                now_ms = time.time() * 1000
                current_count = pygame.joystick.get_count()

                # Only process if count actually changed and debounce time passed
                if current_count != last_device_count and (now_ms - last_device_change_time) > DEVICE_CHANGE_DEBOUNCE_MS:
                    last_device_change_time = now_ms
                    last_device_count = current_count
                    devices = init_joysticks()
                    send_message("devicesChanged", {"devices": devices})

            # Process any pending commands
            while not command_queue.empty():
                try:
                    cmd = command_queue.get_nowait()
                    process_command(cmd)
                except queue.Empty:
                    break

            # Poll inputs at configured interval
            now = time.time() * 1000
            if now - last_poll >= POLL_INTERVAL_MS:
                last_poll = now

                states = []
                for index, js in joysticks.items():
                    try:
                        state = get_input_state(index, js)

                        # Only send if changed
                        if has_state_changed(index, state):
                            states.append(state)
                            previous_states[index] = state
                    except Exception as e:
                        sys.stderr.write(f"Error polling joystick {index}: {e}\n")
                        sys.stderr.flush()

                if states:
                    send_message("inputStates", {"states": states})

            # Small sleep to prevent CPU spinning
            time.sleep(0.005)

    except KeyboardInterrupt:
        pass
    finally:
        pygame.quit()
        send_message("shutdown", {})


if __name__ == "__main__":
    main()
