# Gestão de Férias e Abonos

Aplicação local para coordenadores e gestores administrarem servidores, férias, abonos, alertas, histórico e usuários.

## Como iniciar

1. Clique duas vezes em `iniciar.bat`.
2. No próprio computador, abra `http://localhost:3000`.
3. Em outra máquina da mesma rede, abra o endereço `http://IP-DESTE-COMPUTADOR:3000` mostrado na janela ao iniciar.
4. Se o Windows perguntar, permita o acesso do Node.js apenas em **redes privadas**.

Primeiro acesso master:

- Usuário: `felippe.andreata`
- Senha temporária: `TroqueAgora!2026`

Endereço principal na rede: `http://03-D000363:3000`

Altere a senha imediatamente em **Meu perfil**.

## Recuperação de senha por e-mail

Copie `.env.example` para `.env`, crie uma nova senha de app no Google e preencha:

```env
SMTP_USER=contatotech.tecnologia@gmail.com
SMTP_APP_PASSWORD=SUA_NOVA_SENHA_DE_APP
```

Preencha também `SESSION_SECRET` com uma frase longa e aleatória. O arquivo `.env` é ignorado pelo Git e não deve ser compartilhado.

Sem SMTP configurado, o código de recuperação aparece somente na janela em que o sistema está rodando, para facilitar testes locais.

## Dados e backup

Os dados ficam em `%LOCALAPPDATA%\GestaoFeriasAbonos\data\gestao.db`, evitando problemas de pasta somente leitura no XAMPP. Para fazer backup, pare o sistema e copie essa pasta para um local seguro.

## Observações de rede

- O sistema é destinado à rede local e não deve ser exposto diretamente à internet.
- Se outro computador não conseguir abrir, verifique se ambos estão na mesma rede e se o Firewall do Windows autorizou o Node.js em redes privadas.
- O computador que hospeda o sistema deve permanecer ligado e com a janela do servidor aberta.
