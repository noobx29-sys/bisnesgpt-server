#!/bin/bash

# Function to wait for the app to be ready
wait_for_ready() {
    app_name=$1
    timeout=1800  # 15 minutes timeout
    start_time=$(date +%s)

    echo "Waiting for $app_name to initialize..."

    while true; do
        if pm2 show $app_name | grep -q "online"; then
            # Check the last 100 lines of logs for initialization messages
            log_output=$(pm2 logs $app_name --nostream --lines 100)
            
            # Look for bot initialization messages
            initializing_bots=$(echo "$log_output" | grep "Starting initialization for bot:" | tail -n 1)
            if [ ! -z "$initializing_bots" ]; then
                echo "Currently initializing: $initializing_bots"
            fi

            # Check if initialization is complete
            if echo "$log_output" | grep -q "All bots initialization attempts complete"; then
                echo "$app_name is fully initialized and ready"
                return 0
            fi
        fi

        current_time=$(date +%s)
        elapsed=$((current_time - start_time))
        if [ $elapsed -gt $timeout ]; then
            echo "Timeout waiting for $app_name to be ready"
            return 1
        fi

        sleep 10  # Check every 10 seconds
        echo "Still waiting for $app_name... ($(( elapsed / 60 )) minutes elapsed)"
    done
}

# Determine which instance to update
if pm2 show app-blue | grep -q "online"; then
    OLD_INSTANCE="app-blue"
    NEW_INSTANCE="app-green"
else
    OLD_INSTANCE="app-green"
    NEW_INSTANCE="app-blue"
fi

echo "Current active instance: $OLD_INSTANCE"
echo "Deploying to: $NEW_INSTANCE"

# Update the code
git pull

# Start or reload the new instance
if pm2 show $NEW_INSTANCE | grep -q "online"; then
    echo "Reloading $NEW_INSTANCE"
    pm2 reload $NEW_INSTANCE
else
    echo "Starting $NEW_INSTANCE"
    pm2 start ecosystem.config.js --only $NEW_INSTANCE
fi

# Wait for the new instance to be ready
if wait_for_ready $NEW_INSTANCE; then
    # Switch traffic to the new instance
    echo "Switching traffic to $NEW_INSTANCE"
    curl -X POST http://localhost:8445/switch
    
    # Stop the old instance
    echo "Stopping $OLD_INSTANCE"
    pm2 stop $OLD_INSTANCE
    echo "Deployment complete. New active instance: $NEW_INSTANCE"
else
    echo "Deployment failed. New instance not ready in time."
    pm2 stop $NEW_INSTANCE
    exit 1
fi

# Display current status
pm2 list