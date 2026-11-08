(function () {
  // The editor appends its own query string, so participant context uses the path.
  const context = location.pathname.match(/^\/plugin\/(alice|bob)\/(sample\.(?:docx|xlsx|pptx))\/index\.html$/);
  const user = context?.[1];
  const file = context?.[2];
  let busy = false;
  const authorNames = { alice: 'Алиса Петрова', bob: 'Борис Иванов' };
  // Identity is explicit only for the fixed synthetic participants; the
  // marker is visible in the native editor and is not authenticated.
  const nativeAuthorName = authorNames[user] + ' [PoC:' + user + ']';
  let methods = Promise.resolve();
  let discussionOperations = Promise.resolve();
  let methodFailed = false;

  // executeMethod uses an SDK callback slot. Serialize calls so responses cannot be
  // attributed to the wrong request; after a timeout a reload is required.
  function method(name, args) {
    const call = methods.then(function () {
      if (methodFailed) throw new Error('Связь с редактором потеряна; перезагрузите страницу');
      return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
          methodFailed = true;
          reject(new Error('Редактор не ответил; перезагрузите страницу'));
        }, 12000);
        Asc.plugin.executeMethod(name, args, function (result) {
          clearTimeout(timer);
          resolve(result);
        });
      });
    });
    methods = call.catch(function () {});
    return call;
  }

  function notify(kind, extra) {
    window.top.postMessage(Object.assign({ channel: 'office-discussion-v1', kind: kind, user: user, file: file }, extra), location.origin);
  }

  async function discussion(op, value) {
    if (op === 'list') {
      const comments = await method('GetAllComments', []);
      if (!Array.isArray(comments)) throw new Error('Редактор не вернул список обсуждений');
      return comments;
    }
    if (op === 'add') {
      if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 5000) throw new Error('Введите текст замечания (до 5000 символов Unicode)');
      const id = await method('AddComment', [{ UserId: user, UserName: nativeAuthorName, Text: value.trim(), Time: String(Date.now()), Solved: false, Replies: [] }]);
      if (!id) throw new Error('Редактор не создал замечание; проверьте выделение');
      return id;
    }
    if (op === 'reply') {
      // Replacing a thread can silently overwrite a simultaneous native edit
      // or another client's reply. The bridge fails closed until the editor
      // offers a verified concurrency-safe operation.
      throw new Error('Ответы через панель недоступны: безопасная одновременная запись не подтверждена');
    }
    if (op === 'move' && Asc.plugin.info.editorType === 'word') {
      if (typeof value !== 'string' || !value) throw new Error('Не указан идентификатор обсуждения');
      await method('MoveToComment', [value]);
      return true;
    }
    throw new Error('Операция не поддерживается для этого редактора');
  }

  window.addEventListener('message', function (event) {
    const request = event.data;
    if (event.origin !== location.origin || event.source !== window.top || !request || request.channel !== 'office-discussion-v1' || request.user !== user || request.file !== file || request.kind !== 'request') return;
    const operation = discussionOperations.then(function () { return discussion(request.op, request.value); });
    discussionOperations = operation.catch(function () {});
    operation.then(function (result) {
      notify('response', { id: request.id, result: result });
    }, function (error) { notify('response', { id: request.id, error: error.message }); });
  });

  function run(action) {
    if (busy) return Promise.reject(new Error('Wait for the previous native operation'));
    busy = true;
    const args = { ...action, user, file, editorType: Asc.plugin.info.editorType };
    Asc.scope.validation = args;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { busy = false; reject(new Error('Native plugin command timed out')); }, 15000);
      Asc.plugin.callCommand(function () {
        try {
          const args = Asc.scope.validation;
          if (args.editorType === 'word') {
            const document = Api.GetDocument();
            if (args.op === 'edit') {
              const paragraph = Api.CreateParagraph();
              paragraph.AddText(args.marker || (args.user === 'alice' ? 'ALICE_DOCX' : 'BOB_DOCX'));
              document.Push(paragraph);
            }
            if (args.op === 'select') {
              const paragraphs = document.GetAllParagraphs();
              paragraphs[paragraphs.length - 1].GetRange().Select();
            }
            return JSON.stringify({ paragraphs: document.GetAllParagraphs().map(function (paragraph) { return paragraph.GetText(); }) });
          }
          if (args.editorType === 'cell') {
            const sheet = Api.GetActiveSheet();
            if (args.op === 'prepare') { sheet.GetRange('A3').SetValue(10); sheet.GetRange('B3').SetValue(20); }
            if (args.op === 'edit') sheet.GetRange(args.user === 'alice' ? 'A3' : 'B3').SetValue(args.user === 'alice' ? 17 : 25);
            if (args.op === 'select') sheet.GetRange(args.user === 'alice' ? 'A3' : 'B3').Select();
            return JSON.stringify({ values: sheet.GetRange('A3:C3').GetValue(), formula: sheet.GetRange('C3').GetFormula(), sheet: sheet.GetName() });
          }
          if (args.editorType === 'slide') {
            const presentation = Api.GetPresentation();
            if (args.op === 'edit') {
              const slide = presentation.GetSlideByIndex(args.user === 'alice' ? 0 : 1);
              const shapes = slide.GetAllShapes();
              shapes[1].GetContent().GetElement(0).AddText(' ' + (args.marker || (args.user === 'alice' ? 'ALICE_PPTX' : 'BOB_PPTX')));
            }
            if (args.op === 'select') {
              const slide = presentation.GetSlideByIndex(0);
              slide.Select();
              slide.GetAllShapes()[args.user === 'alice' ? 0 : 1].Select(true);
            }
            const slides = [];
            for (let index = 0; index < presentation.GetSlidesCount(); index++) {
              const texts = [];
              const shapes = presentation.GetSlideByIndex(index).GetAllShapes();
              for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
                const content = shapes[shapeIndex].GetContent();
                if (content) texts.push(content.GetAllParagraphs().map(function (paragraph) { return paragraph.GetText(); }).join('\n'));
              }
              slides.push(texts);
            }
            return JSON.stringify({ slides: slides });
          }
          throw new Error('Unsupported editor type: ' + args.editorType);
        } catch (error) { return JSON.stringify({ error: error.message }); }
      }, false, ['edit', 'prepare'].includes(action.op), function (encoded) {
        clearTimeout(timeout);
        busy = false;
        try {
          const result = JSON.parse(encoded);
          document.querySelector('#result').textContent = JSON.stringify(result, null, 2);
          if (result.error) throw new Error(result.error);
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
  }

  Asc.plugin.init = function () {
    if (!user || !file) throw new Error('Missing native validation participant context');
    window.pocPlugin = { run: run, editorType: Asc.plugin.info.editorType, user: user, file: file };
    if (Asc.plugin.info.editorType === 'word') {
      ['onAddComment', 'onChangeCommentData', 'onRemoveComment'].forEach(function (event) {
        Asc.plugin.attachEditorEvent(event, function () { notify('changed'); });
      });
    }
    notify('ready', { editorType: Asc.plugin.info.editorType });
    document.querySelector('#status').textContent = 'Plugin ready: ' + Asc.plugin.info.editorType + ' · ' + user;
    document.querySelector('#run').disabled = false;
  };
  Asc.plugin.button = function () {};
  document.querySelector('#run').onclick = function () {
    run({ op: document.querySelector('#operation').value }).catch(function (error) { document.querySelector('#result').textContent = error.message; });
  };
}());
