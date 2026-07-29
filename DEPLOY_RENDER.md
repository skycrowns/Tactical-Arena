# Deploy no Render

## Opção 1: Deploy Automático (Blueprint)

1. Crie um repositório no GitHub com estes arquivos:
   - `server.js`
   - `client.html`
   - `package.json`
   - `render.yaml`
   - `.gitignore`

2. Acesse: https://dashboard.render.com/blueprints

3. Clique **"New Blueprint Instance"**

4. Cole a URL do seu repositório GitHub

5. O Render detectará o `render.yaml` e configurará tudo automaticamente

6. Clique **"Apply"** e aguarde o deploy (1-2 minutos)

7. Acesse a URL gerada (ex: `https://tactical-arena.onrender.com`)

---

## Opção 2: Deploy Manual (Web Service)

1. Acesse: https://dashboard.render.com/

2. Clique **"New +"** → **"Web Service"**

3. Conecte seu repositório GitHub (ou use "Public Git repository")

4. Configure:
   - **Name:** `tactical-arena`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** `Free`

5. Clique **"Create Web Service"**

6. Aguarde o build (1-2 minutos)

7. Acesse a URL pública

---

## Opção 3: Deploy via CLI

```bash
# Instale o Render CLI
curl -fsSL https://render.com/install.sh | bash

# Login
render login

# Deploy
render deploy
```

---

## Jogar

1. Jogador 1 acessa a URL e clica **"Criar Sala"**
2. Copia o código de 4 dígitos
3. Jogador 2 acessa a mesma URL, digita o código e clica **"Entrar"**
4. A batalha começa!

---

## Notas

- O plano Free do Render "dorme" após 15 min de inatividade (demora ~30s para acordar)
- Para evitar isso, use o plano Starter ($7/mês) ou configure um ping a cada 10 min
- O servidor usa WebSocket nativo (não precisa de configuração extra no Render)
