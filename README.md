# Squad Tactics — Servidor Dedicado

Servidor autoritativo de jogo de tática em esquadrão por turnos (estilo Gunrox), construído com
[Colyseus](https://colyseus.io/) + Redis, pronto para escalar horizontalmente atrás de um load balancer.

Veja **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** para a arquitetura completa, o raciocínio de
dimensionamento para ~20 mil jogadores simultâneos e o guia de deploy em produção.

## Rodando localmente (rápido, sem Docker)

```bash
npm install
cp .env.example .env      # USE_REDIS=false se não quiser subir Redis agora
npm run dev                # servidor em ws://localhost:2567
```

Abra `client-example/index.html` no navegador em **duas abas** (simula os 2 jogadores),
aponte `serverUrl` para `ws://localhost:2567` e clique em "Entrar na fila".

## Rodando o ambiente completo (multi-instância, como em produção)

```bash
docker compose up --build
```

Isso sobe: 2 instâncias do game server + Redis (coordenação entre instâncias) + Postgres
(histórico de partidas) + Nginx (load balancer com sticky session para WebSocket) na porta `8080`.

Abra `client-example/index.html`, aponte `serverUrl` para `ws://localhost:8080` — o Nginx
distribui as conexões entre as duas instâncias, e ambas continuam sincronizadas via Redis.

## Comandos

| Comando            | O que faz                                      |
|---------------------|-------------------------------------------------|
| `npm run dev`        | Servidor com hot-reload (tsx)                   |
| `npm run build`      | Compila TypeScript → `build/`                   |
| `npm start`          | Roda o build compilado                          |
| `npm run typecheck`  | Só checa tipos, sem gerar arquivos              |

## Estrutura

```
src/
  index.ts          # bootstrap do servidor HTTP + WebSocket + Redis
  redis/setup.ts     # presence/driver do Redis (escalonamento horizontal)
  schema/            # estado sincronizado automaticamente com os clientes
  rooms/BattleRoom.ts # toda a lógica de jogo (turnos, movimento, ataque, vitória)
  game/weapons.ts     # definição das armas
  game/map.ts         # mapas, pathfinding (BFS), linha de visão (Bresenham)
db/init.sql          # schema do Postgres (histórico + base para contas futuras)
nginx/nginx.conf     # load balancer com sticky session
client-example/       # cliente HTML mínimo pra testar ponta a ponta
```

## Próximos passos (fora do escopo desta versão)

- Sistema de contas com login (tabela `players` em `db/init.sql` já preparada para isso)
- Matchmaking por ranking/ELO em vez de fila simples
- Métricas/observabilidade (Prometheus + Grafana) para acompanhar a escala em produção
