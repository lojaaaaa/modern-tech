(function () {
  const user = new URLSearchParams(location.search).get('user');
  const file = new URLSearchParams(location.search).get('file');
  let busy = false;

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
    window.pocPlugin = { run: run, editorType: Asc.plugin.info.editorType, user: user, file: file };
    document.querySelector('#status').textContent = 'Plugin ready: ' + Asc.plugin.info.editorType + ' · ' + user;
    document.querySelector('#run').disabled = false;
  };
  Asc.plugin.button = function () {};
  document.querySelector('#run').onclick = function () {
    run({ op: document.querySelector('#operation').value }).catch(function (error) { document.querySelector('#result').textContent = error.message; });
  };
}());
