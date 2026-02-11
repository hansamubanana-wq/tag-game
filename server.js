const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const PLAYER_SIZE = 25;
const TEACHER_SPEED = 6;
const STUDENT_SPEED = 4.5;
const TASK_COUNT = 5;
const CAPTURE_DISTANCE = 40;
const TASK_DISTANCE = 70;
const EXIT_DISTANCE = 100;

let gameState = {
  players: new Map(),
  tasks: [],
  teacherId: null,
  gameStarted: false,
  tasksCompleted: 0,
  exitOpen: false
};

// タスク生成
function generateTasks() {
  const tasks = [];
  const positions = [
    { x: 200, y: 150 },
    { x: 1000, y: 150 },
    { x: 600, y: 400 },
    { x: 200, y: 650 },
    { x: 1000, y: 650 }
  ];
  
  for (let i = 0; i < TASK_COUNT; i++) {
    tasks.push({
      id: i,
      x: positions[i].x,
      y: positions[i].y,
      completed: false,
      progress: 0
    });
  }
  return tasks;
}

// 障害物
const obstacles = [
  { x: 350, y: 200, width: 150, height: 30 },
  { x: 700, y: 200, width: 150, height: 30 },
  { x: 350, y: 500, width: 150, height: 30 },
  { x: 700, y: 500, width: 150, height: 30 },
  { x: 550, y: 350, width: 100, height: 30 }
];

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', (name) => {
    const player = {
      id: socket.id,
      name: name || 'Student',
      x: Math.random() * 400 + 400,
      y: Math.random() * 200 + 300,
      vx: 0,
      vy: 0,
      isTeacher: false,
      isCaptured: false,
      score: 0
    };

    // 最初のプレイヤーを先生に
    if (gameState.players.size === 0) {
      player.isTeacher = true;
      player.name = '加藤先生';
      gameState.teacherId = socket.id;
    }

    gameState.players.set(socket.id, player);

    // ゲーム開始（2人以上）
    if (gameState.players.size >= 2 && !gameState.gameStarted) {
      gameState.gameStarted = true;
      gameState.tasks = generateTasks();
      gameState.tasksCompleted = 0;
      gameState.exitOpen = false;
    }

    socket.emit('init', {
      id: socket.id,
      players: Array.from(gameState.players.values()),
      tasks: gameState.tasks,
      obstacles: obstacles,
      exitOpen: gameState.exitOpen
    });

    socket.broadcast.emit('playerJoined', player);
  });

  socket.on('move', (direction) => {
    const player = gameState.players.get(socket.id);
    if (!player || player.isCaptured) return;

    const speed = player.isTeacher ? TEACHER_SPEED : STUDENT_SPEED;
    player.vx = direction.x * speed;
    player.vy = direction.y * speed;
  });

  socket.on('disconnect', () => {
    const player = gameState.players.get(socket.id);
    
    if (player && player.isTeacher && gameState.players.size > 1) {
      gameState.players.delete(socket.id);
      // 新しい先生を選出
      const newTeacher = Array.from(gameState.players.values())[0];
      newTeacher.isTeacher = true;
      newTeacher.name = '加藤先生';
      gameState.teacherId = newTeacher.id;
      io.emit('newTeacher', newTeacher.id);
    } else {
      gameState.players.delete(socket.id);
    }

    io.emit('playerLeft', socket.id);
    console.log('Player disconnected:', socket.id);
  });
});

function checkGameEnd() {
  const alivePlayers = Array.from(gameState.players.values()).filter(p => !p.isTeacher && !p.isCaptured);
  if (alivePlayers.length === 0) {
    io.emit('gameEnd', { winner: 'teacher' });
  }
}

// ゲームループ
setInterval(() => {
  if (gameState.players.size === 0 || !gameState.gameStarted) return;

  // プレイヤー位置更新
  gameState.players.forEach(player => {
    if (player.isCaptured) return;

    player.x += player.vx;
    player.y += player.vy;

    // 壁との衝突
    player.x = Math.max(PLAYER_SIZE, Math.min(CANVAS_WIDTH - PLAYER_SIZE, player.x));
    player.y = Math.max(PLAYER_SIZE, Math.min(CANVAS_HEIGHT - PLAYER_SIZE, player.y));

    // 障害物との衝突
    obstacles.forEach(obs => {
      if (player.x + PLAYER_SIZE > obs.x && 
          player.x - PLAYER_SIZE < obs.x + obs.width &&
          player.y + PLAYER_SIZE > obs.y && 
          player.y - PLAYER_SIZE < obs.y + obs.height) {
        player.x -= player.vx;
        player.y -= player.vy;
      }
    });
  });

  // タスク自動進行（近くで立ち止まっている生徒）
  gameState.players.forEach(player => {
    if (player.isTeacher || player.isCaptured) return;
    
    const isMoving = Math.abs(player.vx) > 0.1 || Math.abs(player.vy) > 0.1;
    
    gameState.tasks.forEach(task => {
      if (task.completed) return;
      
      const dx = task.x - player.x;
      const dy = task.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < TASK_DISTANCE && !isMoving) {
        task.progress += 1.5;
        
        if (task.progress >= 100) {
          task.completed = true;
          gameState.tasksCompleted++;
          player.score += 100;
          
          io.emit('taskCompleted', { taskId: task.id, playerId: player.id });
          
          // 全タスク完了で出口オープン
          if (gameState.tasksCompleted >= TASK_COUNT) {
            gameState.exitOpen = true;
            io.emit('exitOpen');
          }
        }
      }
    });
  });

  // 出口での脱出判定
  if (gameState.exitOpen) {
    const exitX = CANVAS_WIDTH / 2;
    const exitY = 80;
    
    gameState.players.forEach(player => {
      if (player.isTeacher || player.isCaptured) return;
      
      const dx = exitX - player.x;
      const dy = exitY - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < EXIT_DISTANCE) {
        player.score += 500;
        player.isCaptured = true;
        io.emit('playerEscaped', { playerId: player.id, name: player.name });
        checkGameEnd();
      }
    });
  }

  // 捕獲判定
  if (gameState.teacherId && gameState.players.has(gameState.teacherId)) {
    const teacher = gameState.players.get(gameState.teacherId);
    
    gameState.players.forEach(player => {
      if (player.id === gameState.teacherId || player.isCaptured || player.isTeacher) return;

      const dx = teacher.x - player.x;
      const dy = teacher.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < CAPTURE_DISTANCE) {
        player.isCaptured = true;
        teacher.score += 200;
        io.emit('playerCaptured', { 
          teacherId: teacher.id, 
          studentId: player.id,
          studentName: player.name 
        });

        checkGameEnd();
      }
    });
  }

  // 状態ブロードキャスト
  io.emit('update', {
    players: Array.from(gameState.players.values()),
    tasks: gameState.tasks,
    exitOpen: gameState.exitOpen
  });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});