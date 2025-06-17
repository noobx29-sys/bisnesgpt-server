#!/bin/bash

# Stop and delete all running processes
pm2 stop all
pm2 delete all

# Start the ecosystem
pm2 start ecosystem.config.js

# Ensure only app-blue is running initially
pm2 stop app-green

# Display current status
pm2 list