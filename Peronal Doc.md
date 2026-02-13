npm install express
node local_command_server.js


curl -s http://127.0.0.1:6060/queue | jq .
curl -i http://127.0.0.1:6060/next

# remove whole queue
curl -X POST http://127.0.0.1:6060/clear | jq .

# discard only the next
curl -X POST http://127.0.0.1:6060/discardNext | jq .