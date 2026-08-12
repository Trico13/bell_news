# Panorama — feed de notícias curado

## O que é
- `scripts/fetch-news.mjs` — coleta RSS das fontes definidas e classifica por
  tema/exclusão usando um filtro de palavras-chave (sem IA, sem custo nenhum),
  salvando o resultado em `docs/data/feed.json`.
- `.github/workflows/update-feed.yml` — roda o script automaticamente 3x por dia
  (07h, 12h, 18h horário de Brasília) via GitHub Actions.
- `docs/index.html` — a página do feed. Lê `docs/data/feed.json` e mostra as
  notícias já filtradas, com botão para abrir a matéria original.

## Como colocar no ar (100% gratuito, sem chave de API nenhuma)

1. **Criar o repositório**: crie um repositório novo no seu GitHub (pode ser
   privado) e suba estes arquivos.

2. **Ativar o GitHub Pages**: Settings → Pages → em "Source" escolha a branch
   `main` e a pasta `/docs`. Depois de alguns minutos o site fica disponível
   em algo como `https://seu-usuario.github.io/panorama/` (em repositório
   privado, o Pages exige GitHub Pro — se o seu for privado e gratuito, veja
   a alternativa abaixo).

3. **Rodar o robô pela primeira vez**: aba "Actions" no repositório → escolha
   o workflow "Atualizar feed" → "Run workflow". Isso gera o primeiro
   `feed.json`. Depois disso ele roda sozinho no horário programado.

4. **Adicionar ao celular dela**: abrir o link no navegador do celular →
   menu → "Adicionar à tela de início". Fica com cara de app.

### Alternativa se o repositório ficar privado
O GitHub Pages gratuito só publica sites de repositórios **públicos**. Como
você deixou o repositório privado pra testar, duas opções:
- deixar privado só até validar que o robô está funcionando (ver o
  `feed.json` sendo gerado na aba Actions/commits), e depois tornar público
  só a pasta `docs` quando for colocar no ar de verdade; ou
- publicar via **Vercel** ou **Netlify** (ambos têm plano gratuito e
  publicam a partir de um repo privado sem problema) — te ajudo a configurar
  se preferir esse caminho.

## Ajustar as fontes

Edite a lista `FONTES` em `scripts/fetch-news.mjs`. Algumas das fontes
combinadas na conversa (G1, Estadão, DW Brasil, CNN Brasil) ainda precisam
ter a URL do RSS confirmada — só a BBC Brasil está validada por enquanto.
Ao adicionar uma fonte nova, teste a URL abrindo ela direto no navegador:
deve aparecer um XML, não uma página normal.

## Custo esperado

Zero. Hospedagem (GitHub Pages/Vercel/Netlify) e execução (GitHub Actions)
são gratuitas no uso normal de um projeto pessoal, e a classificação agora
é feita por palavras-chave, sem chamar nenhuma API paga.

O filtro por palavras-chave é mais simples que uma IA — vai errar mais
classificação e vai deixar passar ou barrar coisa que uma leitura mais
esperta pegaria. Se um dia quiser refinar a curadoria, dá pra reintroduzir
a classificação por IA (o código anterior usava a API da Claude) sem mudar
o resto da estrutura — só voltaria a ter custo por uso.
