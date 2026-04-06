#!/bin/bash
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin"
cd /Users/angelopasian/Desktop/VELQOR/velqor-control
exec npx next dev --port ${PORT:-3000}
