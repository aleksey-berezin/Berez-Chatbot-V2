#!/bin/bash

# dev-pm2.sh: Manage dev server with PM2
# Usage: ./scripts/dev-pm2.sh [start|stop|restart|logs|status|help]

NAME="berez-dev"

function usage() {
  echo "Usage: $0 [start|stop|restart|logs|status|help]"
  echo "  start   - Start dev server with PM2 (default)"
  echo "  stop    - Stop dev server"
  echo "  restart - Restart dev server"
  echo "  logs    - Show logs for dev server"
  echo "  status  - Show PM2 process list"
  echo "  help    - Show this help message"
}

case "$1" in
  start|"")
    echo "🚀 Starting dev server with PM2 as '$NAME'..."
    pm2 start npm --name "$NAME" -- run dev --env DEBUG=true --env NODE_ENV=development
    ;;
  stop)
    echo "🛑 Stopping dev server..."
    pm2 stop "$NAME"
    ;;
  restart)
    echo "🔄 Restarting dev server..."
    pm2 restart "$NAME"
    ;;
  logs)
    echo "📜 Showing logs for dev server... (Ctrl+C to exit)"
    pm2 logs "$NAME"
    ;;
  status)
    pm2 list
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac 