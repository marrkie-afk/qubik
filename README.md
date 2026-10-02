# Qubik server
1. Игра уже лежит в `public/index.html`.
2. `npm install && npm start` → http://localhost:3000
3. Деплой одним сервисом (Render / Railway / Fly.io): Start Command `npm start`, порт берётся из `PORT`.
Игра сама подключается к WebSocket на том же адресе. Если страница лежит отдельно (GitHub Pages), укажите `wss://ваш-сервер` в поле «Сервер» в меню.
