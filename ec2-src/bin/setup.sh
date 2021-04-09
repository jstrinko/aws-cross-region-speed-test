sudo yum update -y
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash
. ~/.nvm/nvm.sh
nvm install node
export NODE_PATH=~/.nvm/versions/node/v15.14.0/lib/node_modules/
npm install -g express
node server.js > ~/server-output.log 2>&1 &
node client.js > ~/test-output.json.log 2>&1 &
