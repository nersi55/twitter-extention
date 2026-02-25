npm install express
node local_command_server.js


curl -s http://127.0.0.1:6060/queue | jq .
curl -i http://127.0.0.1:6060/next

# remove whole queue
curl -X POST http://127.0.0.1:6060/clear | jq .

# discard only the next
curl -X POST http://127.0.0.1:6060/discardNext | jq .



Replay:

curl -s -X POST http://127.0.0.1:6060/enqueue \
  -H "Content-Type: application/json" \
  -d '{"id":"cmd-reply-1","action":"replyList","count":3,"url":"https://x.com/i/lists/1591905950507716608","messages":["Thanks!","Nice.","👍"]}' | jq .

Enqueue a quote job:


  curl -s -X POST http://127.0.0.1:6060/enqueue \
  -H "Content-Type: application/json" \
  -d '{"id":"cmd-quote-1","action":"quoteList","count":2,"url":"https://x.com/i/lists/159...","messages":["Nice thread","Good read"]}' | jq .


Enqueue a repost (retweet) job:

curl -s -X POST http://127.0.0.1:6060/enqueue \
  -H "Content-Type: application/json" \
  -d '{"id":"cmd-quote-1","action":"quoteList","count":2,"url":"https://x.com/i/lists/159...","messages":["Nice thread","Good read"]}' | jq .

