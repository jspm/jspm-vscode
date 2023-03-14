import { Generator } from '@jspm/generator';
const vscode = require('vscode');

// Default available environment conditions (the user can configure their own
// custom conditions if they want):
const conditions = [
  'browser',
  'module',
  'development',
  'production',
  'node',
  'deno'
];

exports.activate = function(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('jspm-vscode.generate', cmdGenerate)
  );
};


async function cmdGenerate() {
  const cfg = vscode.workspace.getConfiguration('jspm.generate');

  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor && !vscode.workspace.workspaceFolders) {
    vscode.window.showWarningMessage('No file, folder or workspace open.');
    return;
  }

  let fileUri;
  if (activeTextEditor) {
    if (activeTextEditor.document.uri.scheme === 'untitled') {
      vscode.window.showWarningMessage('Cannot generate import map for unsaved file.');
      return;
    }
    fileUri = activeTextEditor.document.uri.with({ path: activeTextEditor.document.uri.path });
  } else {
    const folderUri = vscode.workspace.workspaceFolders[0].uri;
    fileUri = folderUri.with({ path: folderUri.path + '/' });
  }

  // Should we inject preload attributes?
  let preload = cfg.preload === 'always';
  if (cfg.preload === 'ask') {
    const choice = await vscode.window.showQuickPick([
      { label: 'yes', description: 'Yes', },
      { label: 'no', description: 'No' },
      { label: 'always', description: 'Yes (remember this option)' },
      { label: 'never', description: 'No (remember this option)' },
    ], {
      matchOnDescription: true,
      title: 'Generate: Inject preloads?',
    });
    if (!choice || !choice.label) return;
    if (choice.label === 'yes')
      preload = true;
    else if (choice.label === 'always' || choice.label === 'never') {
      await cfg.update('preload', choice.label, true);
      preload = cfg.preload === 'always';
    }
  }

  // Generate list of possible environments to generate for:
  let env = cfg.defaultConditions ?
    cfg.defaultConditions.split(',').map(item => item.trim()) :
    ['production', 'browser', 'module'];
  const items = conditions.map(name => ({
    name,
    label: name + (name === 'module' ? ' (recommended)' : '')
  }));
  for (const name of env) {
    if (!items.find(item => item.name === name))
      items.push({ name, label: name });
  }

  // Ask user which of the possible environments they want to generate for:
  const qp = vscode.window.createQuickPick();
  qp.canSelectMany = true;
  qp.items = items;
  let production = null;
  function checkSetProduction(label) {
    if (label === 'production') {
      if (production === false)
        return true;
      production = true;
    }
    if (label === 'development') {
      if (production === true)
        return true;
      production = false;
    }
    return false;
  }
  qp.selectedItems = qp.items.filter(({ name }) => {
    if (!env.includes(name))
      return false;
    if (name === 'development' || name === 'production')
      return !checkSetProduction(name);
    return true;
  });
  production = null;
  qp.matchOnDescription = true;
  qp.title = 'Generate: Select environment conditions:';
  qp.show();
  qp.onDidChangeSelection((items) => {
    if (production && items.every(({ name }) => name !== 'production') ||
      production === false && items.every(({ name }) => name !== 'development')) {
      production = null;
      return;
    }
    for (let i = 0; i < items.length; i++) {
      if (checkSetProduction(items[i].name)) {
        items.splice(items.findIndex(({ name }) => name === (production ? 'production' : 'development')), 1);
        production = !production;
        qp.selectedItems = items;
        break;
      }
    }
    env = qp.selectedItems.map(({ name }) => name);
    cfg.update('defaultConditions', env.join(','), true);
  });
  if (!await new Promise(resolve => {
    qp.onDidAccept(() => resolve(true));
    qp.onDidHide(() => {
      qp.dispose();
      resolve(false);
    });
  }))
    return;
  qp.hide();

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Window,
    title: `Generating Import Map for ${fileUri.toString().split('/').pop()}`
  }, async progress => {
    progress.report({ increment: 0 });

    const generator = new Generator({
      mapUrl: new URL(fileUri.toString()),
      env
    });

    (async () => {
      for await (const { type, message } of generator.logStream()) {
        progress.report({ message: `${type}: ${message}` });
      }
    })();

    switch (activeTextEditor?.document?.languageId) {
      case 'pug':
      case 'jade':
      case 'php':
      case 'html':
        const doc = activeTextEditor.document;
        const text = doc.getText();

        try {
          const pins = await generator.addMappings(text, fileUri.toString());
          var output = await generator.htmlInject(text, {
            htmlUrl: fileUri.toString(),
            pins,
            preload,
            integrity: preload,
            whitespace: true,
            esModuleShims: true,
            comment: ` Generated by @jspm/generator VSCode Extension - https://github.com/jspm/jspm-vscode `
          });
        }
        catch (e) {
          vscode.window.showErrorMessage(e.toString());
          return;
        }

        const textAfter = doc.getText();
        if (text !== textAfter) {
          vscode.window.showErrorMessage(`Document changes were made during generation - terminating import map injection. Try running generation again.`);
          return;
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          doc.uri,
          new vscode.Range(doc.positionAt(0), doc.positionAt(text.length - 1)),
          output,
        );
        await vscode.workspace.applyEdit(edit);
        break;

      case 'javascript':
      case 'javascriptreact':
      case 'vue':
      case 'typescript':
      case 'typescriptreact': {
        try {
          await generator.link(fileUri.toString());
        }
        catch (e) {
          vscode.window.showErrorMessage(e.toString());
          return;
        }
        const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(generator.getMap(), null, 2) + '\n' });
        vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
        break;
      }

      default: {
        vscode.window.showErrorMessage("Please run import map generation from within a html/js/jsx/ts/tsx/vue source file.");
        return;
      }
    }
    vscode.window.showInformationMessage('Generated Import Map');

    progress.report({ increment: 100 });
  });
}
