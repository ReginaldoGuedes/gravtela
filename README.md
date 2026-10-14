# gravtela
App em desenvolvimento de gravação de tela desktop web - free
Inicialmente o projeto era para gravar tela de celular, mas tive implicações no desenvolvimento, porém se a comunidade ajudar.

# Gravador de tela

Aplicação web para gravar a tela, adicionar uma câmera como miniatura móvel e editar vídeos diretamente no navegador.

**Aplicação publicada:** [https://gravtela.netlify.app/](https://gravtela.netlify.app/)

## Recursos

- Gravação de uma aba, janela ou tela, conforme as opções oferecidas pelo navegador sem limites de tempo.
- Gravação opcional com câmera: a miniatura pode ser movida e redimensionada durante a captura e aparece em uma faixa separada no editor.
- Controles para pausar, retomar e finalizar a gravação.
- Opções de qualidade de captura (480p, 720p e 1080p), microfone e áudio da aba ou sistema.
- Editor com timeline de múltiplas faixas para vídeo, áudio e texto.
- Cortar, dividir, duplicar, remover e reposicionar trechos na timeline.
- Ajustar velocidade, volume, silêncio, fades, enquadramento, brilho, contraste e saturação.
- Adicionar e posicionar textos sobre o vídeo.
- Importar vídeos, imagens, GIFs e áudio.
- Exportar a edição ou salvar o vídeo original.
- Funciona com e sem internet basta baixar o arquivo e abrir no navegador.

## Como usar

1. Abra a aplicação pelo endereço publicado ou sirva os arquivos localmente.
2. Na tela inicial, escolha **Gravar**, **Gravar com câmera** ou **Editar vídeo**.
3. Ao gravar, escolha a origem e a qualidade. Se selecionar **Gravar com câmera**, também poderá escolher uma câmera conectada.
4. Conceda as permissões solicitadas pelo navegador. Depois da contagem regressiva, a gravação começa.
5. Use **Pausar/Retomar** ou **Parar gravação**. Ao finalizar, escolha **Editar vídeo** ou **Salvar vídeo**.
6. No editor, faça as alterações desejadas e escolha **Salvar edição**. A exportação é feita em tempo real: mantenha a página aberta até terminar.

## Requisitos e compatibilidade

- A captura de tela exige uma origem segura, como HTTPS ou `localhost`, e um navegador que implemente `getDisplayMedia` e `MediaRecorder`.
- O suporte à captura de tela varia entre navegador, sistema operacional e dispositivo. Alguns navegadores móveis não permitem que páginas web capturem a tela. Nesses casos, use a gravação de tela do próprio dispositivo e importe o arquivo pela opção **Editar vídeo**.
- A disponibilidade de áudio interno depende do navegador, da origem escolhida e das opções habilitadas no seletor de compartilhamento. O microfone requer permissão adicional.
- A câmera requer uma câmera disponível e permissão para acessá-la.
- O formato gravado (MP4 ou WebM) depende dos formatos suportados pelo navegador.
- A aplicação não pode iniciar a captura nem selecionar a tela sem uma ação e autorização explícitas do usuário.

## Executar localmente

O projeto é estático e não precisa de instalação de dependências ou etapa de compilação. A pasta raiz contém:

```text
index.html
app.js
styles.css
README.md
```

Sirva a pasta usando um servidor local, por exemplo a extensão **Live Server** do VS Code, e abra o endereço `localhost` fornecido pelo servidor. Algumas APIs de mídia podem não funcionar ao abrir `index.html` diretamente como arquivo (`file://`).

## Publicar no Netlify

O site usa `index.html` na raiz como página inicial e carrega `app.js` e `styles.css` por caminhos relativos.

- **Com GitHub:** conecte o repositório no Netlify e defina a pasta de publicação como a raiz do projeto. Não é necessário comando de build.
- **Publicação manual:** envie os arquivos do projeto mantendo `index.html`, `app.js` e `styles.css` juntos na pasta publicada.

Após a publicação, confirme que o endereço está em HTTPS e teste a captura no navegador e dispositivo pretendidos. Um deploy do Netlify não altera automaticamente os arquivos locais; alterações precisam ser enviadas ao repositório conectado ou publicadas novamente.

## Privacidade

O acesso à tela, câmera e microfone é solicitado pelo navegador e controlado pelo usuário. A gravação e a edição são realizadas no navegador; esta aplicação não possui um servidor próprio para receber os vídeos. Os dados temporários podem usar o armazenamento local do navegador durante a gravação e devem ser salvos ou exportados para manter uma cópia.
