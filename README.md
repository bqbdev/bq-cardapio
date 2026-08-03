# bq menu / BQ Pedidos

Sistema SaaS estático para cardápio digital, pedidos online, cadastro de clientes por WhatsApp, financeiro simples e administração multiestabelecimento.

## Arquivos principais

- `index.html`: landing page pública.
- `cadastro.html`: solicitação pública de acesso.
- `login.html`: login de admin e estabelecimento.
- `admin.html`: painel geral da plataforma.
- `painel.html`: painel do estabelecimento.
- `cardapio.html`: cardápio público por link.
- `pedido.html`: confirmação e acompanhamento do pedido.
- `style.css`: identidade visual e responsividade.
- `firebase.js`: configuração Firebase e exports usados pelo projeto.
- `auth.js`: cadastro prévio e login.
- `admin.js`: dashboard SaaS, solicitações e estabelecimentos.
- `painel.js`: dashboard do estabelecimento, pedidos, categorias, produtos, sabores, adicionais, taxas e configurações.
- `cardapio.js`: cardápio público, carrinho, cliente por WhatsApp e checkout.
- `clientes.js`: busca e atualização de cliente por WhatsApp.
- `financeiro.js`: resumo financeiro.
- `taxas.js`: cálculo de taxas por pagamento.
- `firestore.rules`: regras sugeridas de segurança.

## Configuração Firebase

1. Crie um projeto no Firebase.
2. Ative Authentication com provedor E-mail/senha.
3. Crie o banco Firestore.
4. Publique o conteúdo de `firestore.rules` nas regras do Firestore.
5. Confira as credenciais web do Firebase em `firebase.js`.

## Criar admin principal

1. Crie um usuário no Firebase Authentication.
2. Copie o UID desse usuário.
3. No Firestore, crie o documento `admins/{UID}` com, por exemplo:

```json
{
  "nome": "Admin principal",
  "email": "admin@seudominio.com",
  "ativo": true
}
```

Ao logar com esse usuário, o sistema redireciona para `admin.html`.

## Aprovar estabelecimento

1. O estabelecimento preenche `cadastro.html`.
2. O admin aprova em `admin.html`.
3. O sistema cria o documento em `estabelecimentos` e as configurações iniciais.
4. Ao aprovar, o admin recebe uma mensagem pronta de WhatsApp com o link de ativação.
5. O estabelecimento acessa `ativar.html`, digita a senha duas vezes e o sistema cria o usuário no Firebase Authentication.

Esse fluxo não exige que o admin crie manualmente o usuário do estabelecimento.

## Link público do cardápio

O sistema gera links no formato:

```text
/loja/ID_DO_ESTABELECIMENTO/nome-da-loja
```

No Firebase Hosting, essa rota passa pela Function `previewCardapio`, que lê o nome e o logo do estabelecimento no Firestore e entrega as metatags corretas para WhatsApp, Facebook, Instagram, X e outras plataformas. Depois, o visitante é direcionado ao cardápio estático.

O arquivo `404.html` mantém os links acessíveis durante a transição a partir do GitHub Pages, mas a prévia personalizada somente passa a funcionar após a publicação da Function e a conexão do domínio ao Firebase Hosting.

## Publicação no Firebase Hosting

Pré-requisitos:

1. Alterar o projeto `bq-cardapio` para o plano Blaze e vincular uma conta de faturamento.
2. Instalar a versão atual do Firebase CLI e autenticar a conta proprietária do projeto.
3. Na raiz do projeto, executar `firebase deploy --only functions,hosting`.
4. No Console do Firebase, conectar o domínio `bqmenu.bqsystems.com.br` ao Hosting e aplicar os registros DNS informados.
5. Depois da propagação do domínio, testar um link `/loja/ID/nome-da-loja` no WhatsApp.

A Function usa `minInstances: 0`, limita a escala a cinco instâncias e mantém cache de dez minutos no CDN para controlar custos. Alterações de logo podem levar até dez minutos para aparecer nas novas prévias. O cache antigo do próprio WhatsApp também pode precisar expirar.

## Delivery

O delivery real ainda não foi implementado. O sistema mostra o módulo como "em breve" e deixa a estrutura pronta para evoluir.

## Asaas

Asaas não foi implementado neste momento, conforme solicitado.
