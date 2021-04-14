echo "UPDATING YUM"
sudo yum update -y
echo "FETCHING NVM"
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash
. ~/.nvm/nvm.sh
echo "INSTALLING NODE"
nvm install node
export NODE_PATH=~/.nvm/versions/node/v15.14.0/lib/node_modules/
echo "INSTALLING EXPRESS"
npm install -g express
echo "INSTALLING PING"
npm install -g ping
killall node
echo "STARTING SERVER"
node ~/server.js > ~/server-output.log 2>&1 &
echo "STARTING CLIENT"
node ~/client.js > ~/test-output.json.log 2>&1 &
