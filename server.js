const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const players = new Map();
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 20;
const IT_SPEED = 5;
const NORMAL_SPEED = 4;

let currentIt = null;

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', (name) => {
    const player = {
      id: socket.id,
      name: name || 'Player',
      x: Math.random() * (CANVAS_WIDTH - 100) + 50,
      y: Math.random() * (CANVAS_HEIGHT - 100) + 50,
      vx: 0,
      vy: 0,
      isIt: false,
      score: 0,
      survivalTime: 0
    };

    // 最初のプレイヤーを鬼に設定
    if (players.size === 0) {
      player.isIt = true;
      currentIt = socket.id;
    }

    players.set(socket.id, player);
    
    socket.emit('init', {
      id: socket.id,
      players: Array.from(players.values())
    });

    socket.broadcast.emit('playerJoined', player);
  });

  socket.on('move', (direction) => {
    const player = players.get(socket.id);
    if (!player) return;

    const speed = player.isIt ? IT_SPEED : NORMAL_SPEED;
    player.vx = direction.x * speed;
    player.vy = direction.y * speed;
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player && player.isIt && players.size > 1) {
      // 鬼が切断したら次のプレイヤーを鬼に
      players.delete(socket.id);
      const newIt = Array.from(players.keys())[0];
      if (newIt) {
        players.get(newIt).isIt = true;
        currentIt = newIt;
        io.emit('newIt', newIt);
      }
    } else {
      players.delete(socket.id);
    }
    io.emit('playerLeft', socket.id);
    console.log('Player disconnected:', socket.id);
  });
});

// ゲームループ
setInterval(() => {
  if (players.size === 0) return;

  // プレイヤー位置更新
  players.forEach(player => {
    player.x += player.vx;
    player.y += player.vy;

    // 壁との衝突
    player.x = Math.max(PLAYER_SIZE, Math.min(CANVAS_WIDTH - PLAYER_SIZE, player.x));
    player.y = Math.max(PLAYER_SIZE, Math.min(CANVAS_HEIGHT - PLAYER_SIZE, player.y));

    // 生存時間加算（鬼以外）
    if (!player.isIt) {
      player.survivalTime += 1/60;
    }
  });

  // 衝突判定
  if (currentIt && players.has(currentIt)) {
    const itPlayer = players.get(currentIt);
    players.forEach(player => {
      if (player.id === currentIt || player.isIt) return;

      const dx = itPlayer.x - player.x;
      const dy = itPlayer.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < PLAYER_SIZE * 2) {
        // 鬼交代
        itPlayer.isIt = false;
        itPlayer.score += Math.floor(itPlayer.survivalTime);
        itPlayer.survivalTime = 0;
        
        player.isIt = true;
        player.survivalTime = 0;
        currentIt = player.id;

        io.emit('tag', {
          oldIt: itPlayer.id,
          newIt: player.id
        });
      }
    });
  }

  // 状態をブロードキャスト
  io.emit('update', Array.from(players.values()));
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});