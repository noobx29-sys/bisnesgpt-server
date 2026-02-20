#!/bin/bash
if [ -f .env ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "${line// }" ]]; then
            continue
        fi
        line=$(echo "$line" | sed 's/^[[:space:]]*//; s/[[:space:]]*=[[:space:]]*/=/')
        # If the value is wrapped in quotes, let's leave them for now unless it breaks Node
        export "$line"
    done < .env
fi
