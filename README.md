# BQ Menu / BQ Pedidos

Sistema SaaS estatico para cardapio digital, pedidos online, cadastro de clientes por WhatsApp, financeiro simples e administracao multiestabelecimento.

## Arquivos principais

- `index.html`: landing page publica.
- `cadastro.html`: solicitacao publica de acesso.
- `login.html`: login de admin e estabelecimento.
- `admin.html`: painel geral da plataforma.
- `painel.html`: painel do estabelecimento.
- `cardapio.html`: cardapio publico por link.
- `pedido.html`: confirmacao e envio do pedido pelo WhatsApp.
- `style.css`: identidade visual e responsividade.
- `firebase.js`: configuracao Firebase e exports usados pelo projeto.
- `auth.js`: cadastro previo e login.
- `admin.js`: dashboard SaaS, solicitacoes e estabelecimentos.
- `painel.js`: dashboard do estabelecimento, pedidos, categorias, produtos, taxas e configuracoes.
- `cardapio.js`: cardapio publico, carrinho, cliente por WhatsApp e checkout.
- `clientes.js`: busca e atualizacao de cliente por WhatsApp.
- `financeiro.js`: resumo financeiro.
- `taxas.js`: calculo de taxas por pagamento.
- `firestore.rules`: regras sugeridas de seguranca.

## Configuracao Firebase

1. Crie um projeto no Firebase.
2. Ative Authentication com provedor E-mail/senha.
3. Crie o banco Firestore.
4. Publique o conteudo de `firestore.rules` nas regras do Firestore.
5. Confira as credenciais web do Firebase em `firebase.js`.

## Criar admin principal

1. Crie um usuario no Firebase Authentication.
2. Copie o UID desse usuario.
3. No Firestore, crie o documento `admins/{UID}` com, por exemplo:

```json
{
  "nome": "Admin principal",
  "email": "admin@seudominio.com",
  "ativo": true
}
```

Ao logar com esse usuario, o sistema redireciona para `admin.html`.

## Aprovar estabelecimento

1. O estabelecimento preenche `cadastro.html`.
2. O admin aprova em `admin.html`.
3. O sistema cria o documento em `estabelecimentos` e as configuracoes iniciais.
4. Crie manualmente o usuario do estabelecimento no Firebase Authentication.
5. Copie o UID do usuario criado e preencha o campo `UID do usuario Auth` no editor do estabelecimento em `admin.html`.

Esse passo manual evita expor criacao de usuarios privilegiada no front-end. Para automatizar depois, use Cloud Functions com Admin SDK.

## Link publico do cardapio

Use:

```text
cardapio.html?estabelecimento=ID_DO_ESTABELECIMENTO
```

Esse link funciona no GitHub Pages depois que o Firebase estiver configurado.

## Delivery

O delivery real nao foi implementado. O sistema mostra o modulo como "em breve" e deixa a estrutura pronta para evoluir.

## Asaas

Asaas nao foi implementado neste momento, conforme solicitado.
