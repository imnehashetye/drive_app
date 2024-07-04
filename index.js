const express = require('express');
const { google } = require('googleapis');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
  }
});

const port = 3000;

const cors = require('cors');

// Add CORS middleware
app.use(cors({
  origin: '*', // Or specify your client URL
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// Serve static files from the 'public' directory (if needed)
app.use(express.static(path.join(__dirname, 'public')));

// OAuth2 client setup
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const TOKEN_PATH = 'token.json';

// Load or request authorization
function authorize(callback) {
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oauth2Client, callback);
    oauth2Client.setCredentials(JSON.parse(token));
    callback(oauth2Client);
  });
}

function getAccessToken(oauth2Client, callback) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
}

// OAuth2 callback route
app.get('/oauth2callback', (req, res) => {
  const code = req.query.code;
  if (code) {
    oauth2Client.getToken(code, (err, token) => {
      if (err) {
        console.error('Error retrieving access token', err);
        return res.status(400).send('Error retrieving access token');
      }
      oauth2Client.setCredentials(token);
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      res.send('Authorization successful! You can close this tab.');
    });
  } else {
    res.status(400).send('No authorization code provided.');
  }
});

// List files endpoint
app.get('/files', (req, res) => {
  authorize((auth) => {
    const drive = google.drive({ version: 'v3', auth });
    drive.files.list({}, (err, response) => {
      if (err) {
        console.log('Error fetching files:', err);
        return res.status(500).send(err);
      }
      console.log('response.data.fileshhhh', response.data.files)
      res.send(response.data.files);
    });
  });
});

// Download file endpoint
app.get('/files/:fileId/download', (req, res) => {
  authorize((auth) => {
    const drive = google.drive({ version: 'v3', auth });
    const fileId = req.params.fileId;
    const dest = fs.createWriteStream(path.join(__dirname, 'downloaded_file'));
    drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' },
      (err, response) => {
        if (err) {
          console.log('Error downloading file:', err);
          return res.status(500).send(err);
        }
        response.data
          .on('end', () => {
            res.download(path.join(__dirname, 'downloaded_file'));
          })
          .on('error', (err) => {
            console.error('Error downloading file:', err);
            res.status(500).send(err);
          })
          .pipe(dest);
      }
    );
  });
});

// List permissions endpoint
app.get('/files/:fileId/permissions', (req, res) => {
  authorize((auth) => {
    const drive = google.drive({ version: 'v3', auth });
    const fileId = req.params.fileId;
    drive.permissions.list({ fileId }, (err, response) => {
      if (err) {
        console.log('Error fetching permissions:', err);
        return res.status(500).send(err);
      }
      console.log('response.data.permissions', response.data)
      res.send(response.data.permissions);
    });
  });
});

// Real-time updates with Socket.IO
io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('watchFile', (fileId) => {
    console.log(`Watching file: ${fileId}`);

    const intervalId = setInterval(() => {
      authorize((auth) => {
        const drive = google.drive({ version: 'v3', auth });
        drive.permissions.list({ fileId }, (err, response) => {
          if (err) {
            console.error('Error retrieving permissions:', err);
            return;
          }
          console.log('Permissions retrieved:', response.data.permissions);
          socket.emit('permissionsUpdated', response.data.permissions);
        });
      });
    }, 5000);

    socket.on('disconnect', () => {
      clearInterval(intervalId);
      console.log('User disconnected');
    });
  });
});

server.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
