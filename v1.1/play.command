#!/bin/bash
# Double-click this to play. It starts the local server and opens the game.
# If 8770 is already taken (an older copy still running, or another project), walk up
# until a free port turns up — a double-click that dies with "Address already in use"
# looks exactly like a broken game.
cd "$(dirname "$0")"
for port in 8770 8771 8772 8773 8774; do
  if ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
    exec python3 serve.py "$port"
  fi
done
echo "Ports 8770-8774 are all busy. Close the other server and try again."
read -r -p "Press return to close."
