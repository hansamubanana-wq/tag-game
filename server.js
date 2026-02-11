const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const CANVAS_WIDTH = 2400;
const CANVAS_HEIGHT = 1600;
const PLAYER_SIZE = 30;
const TEACHER_SPEED = 6.5;
const STUDENT_SPEED = 5;
const TASK_COUNT = 8;
const CAPTURE_DISTANCE = 50;
const TASK_DISTANCE = 80;
const EXIT_DISTANCE = 120;

let gameState = {
  players: new Map(),
  tasks: [],
  teacherId: null,
  gameStarted: false,
  countdown: 0,
  tasksCompleted: 0,
  exitOpen: false,
  lobbyHost: null
};

// タスク生成
function generateTasks() {
  const tasks = [];
  const positions = [
    { x: 300, y: 250 },
    { x: 2100, y: 250 },
    { x: 800, y: 400 },
    { x: 1600, y: 400 },
    { x: 300, y: 800 },
    { x: 2100, y: 800 },
    { x: 1200, y: 1200 },
    { x: 1200, y: 600 }
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
  { x: 500, y: 300, width: 200, height: 40 },
  { x: 1700, y: 300, width: 200, height: 40 },
  { x: 500, y: 700, width: 200, height: 40 },
  { x: 1700, y: 700, width: 200, height: 40 },
  { x: 1100, y: 500, width: 200, height: 40 },
  { x: 400, y: 1100, width: 150, height: 40 },
  { x: 1850, y: 1100, width: 150, height: 40 },
  { x: 1100, y: 1300, width: 200, height: 40 }
];

function getStudentSpawn() {
  // 生徒は左下エリアにスポーン
  return {
    x: Math.random() * 400 + 200,
    y: Math.random() * 400 + 1000
  };
}

function getTeacherSpawn() {
  // 先生は右上エリアにスポーン
  return {
    x: Math.random() * 400 + 1800,
    y: Math.random() * 400 + 200
  };
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', (name) => {
    const spawn = getStudentSpawn();
    const player = {
      id: socket.id,
      name: name || 'Student',
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      isTeacher: false,
      isCaptured: false,
      score: 0,
      isReady: false
    };

    // 最初のプレイヤーをホストに
    if (gameState.players.size === 0) {
      gameState.lobbyHost = socket.id;
    }

    gameState.players.set(socket.id, player);

    socket.emit('init', {
      id: socket.id,
      players: Array.from(gameState.players.values()),
      tasks: gameState.tasks,
      obstacles: obstacles,
      exitOpen: gameState.exitOpen,
      gameStarted: gameState.gameStarted,
      isHost: socket.id === gameState.lobbyHost
    });

    io.emit('lobbyUpdate', {
      players: Array.from(gameState.players.values()),
      hostId: gameState.lobbyHost
    });
  });

  socket.on('setTeacher', (playerId) => {
    if (socket.id !== gameState.lobbyHost) return;
    
    // 全員の先生フラグをリセット
    gameState.players.forEach(p => {
      p.isTeacher = false;
    });

    // 指定されたプレイヤーを先生に
    const teacher = gameState.players.get(playerId);
    if (teacher) {
      teacher.isTeacher = true;
      teacher.name = '加藤先生';
      gameState.teacherId = playerId;
    }

    io.emit('lobbyUpdate', {
      players: Array.from(gameState.players.values()),
      hostId: gameState.lobbyHost
    });
  });

  socket.on('startGame', () => {
    if (socket.id !== gameState.lobbyHost || gameState.gameStarted) return;
    
    // 先生が選ばれていない場合は最初のプレイヤーを先生に
    if (!gameState.teacherId && gameState.players.size > 0) {
      const firstPlayer = Array.from(gameState.players.values())[0];
      firstPlayer.isTeacher = true;
      firstPlayer.name = '加藤先生';
      gameState.teacherId = firstPlayer.id;
    }

    // スポーン地点を設定
    gameState.players.forEach(player => {
      if (player.isTeacher) {
        const spawn = getTeacherSpawn();
        player.x = spawn.x;
        player.y = spawn.y;
      } else {
        const spawn = getStudentSpawn();
        player.x = spawn.x;
        player.y = spawn.y;
      }
      player.isCaptured = false;
      player.score = 0;
    });

    gameState.gameStarted = true;
    gameState.tasks = generateTasks();
    gameState.tasksCompleted = 0;
    gameState.exitOpen = false;
    gameState.countdown = 3;

    io.emit('gameStart', {
      players: Array.from(gameState.players.values()),
      tasks: gameState.tasks
    });

    // カウントダウン
    const countdownInterval = setInterval(() => {
      gameState.countdown--;
      io.emit('countdown', gameState.countdown);
      
      if (gameState.countdown <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);
  });

  socket.on('move', (direction) => {
    const player = gameState.players.get(socket.id);
    if (!player || player.isCaptured || !gameState.gameStarted || gameState.countdown > 0) return;

    const speed = player.isTeacher ? TEACHER_SPEED : STUDENT_SPEED;
    player.vx = direction.x * speed;
    player.vy = direction.y * speed;
  });

  socket.on('restartGame', () => {
    if (socket.id !== gameState.lobbyHost) return;

    gameState.gameStarted = false;
    gameState.countdown = 0;
    gameState.tasksCompleted = 0;
    gameState.exitOpen = false;
    gameState.teacherId = null;

    gameState.players.forEach(player => {
      player.isTeacher = false;
      player.isCaptured = false;
      player.score = 0;
      player.name = player.name.replace('加藤先生', 'Player');
      const spawn = getStudentSpawn();
      player.x = spawn.x;
      player.y = spawn.y;
    });

    io.emit('backToLobby', {
      players: Array.from(gameState.players.values()),
      hostId: gameState.lobbyHost
    });
  });

  socket.on('disconnect', () => {
    const player = gameState.players.get(socket.id);
    gameState.players.delete(socket.id);

    // ホストが切断したら次のプレイヤーをホストに
    if (socket.id === gameState.lobbyHost && gameState.players.size > 0) {
      gameState.lobbyHost = Array.from(gameState.players.keys())[0];
    }

    // 先生が切断したら次のプレイヤーを先生に
    if (player && player.isTeacher && gameState.players.size > 0 && gameState.gameStarted) {
      const newTeacher = Array.from(gameState.players.values())[0];
      newTeacher.isTeacher = true;
      newTeacher.name = '加藤先生';
      gameState.teacherId = newTeacher.id;
      io.emit('newTeacher', newTeacher.id);
    }

    io.emit('playerLeft', socket.id);
    io.emit('lobbyUpdate', {
      players: Array.from(gameState.players.values()),
      hostId: gameState.lobbyHost
    });
    
    console.log('Player disconnected:', socket.id);
  });
});

function checkGameEnd() {
  const alivePlayers = Array.from(gameState.players.values()).filter(p => !p.isTeacher && !p.isCaptured);
  if (alivePlayers.length === 0) {
    io.emit('gameEnd', { 
      winner: 'teacher',
      players: Array.from(gameState.players.values())
    });
    gameState.gameStarted = false;
  }
}

function checkAllEscaped() {
  const totalStudents = Array.from(gameState.players.values()).filter(p => !p.isTeacher).length;
  const escapedStudents = Array.from(gameState.players.values()).filter(p => !p.isTeacher && p.isCaptured).length;
  
  if (totalStudents > 0 && escapedStudents === totalStudents) {
    io.emit('gameEnd', { 
      winner: 'students',
      players: Array.from(gameState.players.values())
    });
    gameState.gameStarted = false;
  }
}

// ゲームループ
setInterval(() => {
  if (gameState.players.size === 0 || !gameState.gameStarted || gameState.countdown > 0) return;

  // プレイヤー位置更新
  gameState.players.forEach(player => {
    if (player.isCaptured && !player.isTeacher) return;

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

  // タスク自動進行
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
    const exitY = 150;
    
    gameState.players.forEach(player => {
      if (player.isTeacher || player.isCaptured) return;
      
      const dx = exitX - player.x;
      const dy = exitY - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < EXIT_DISTANCE) {
        player.score += 500;
        player.isCaptured = true;
        io.emit('playerEscaped', { playerId: player.id, name: player.name });
        checkAllEscaped();
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