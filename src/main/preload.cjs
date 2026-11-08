const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
const api = {
  appInfo: invoke('app:info'),
  preferences: { get: invoke('app:preferences:get'), set: invoke('app:preferences:set') },
  projects: { list: invoke('projects:list'), active: invoke('projects:active'), choose: invoke('projects:choose'), add: invoke('projects:add'), open: invoke('projects:open'), rename: invoke('projects:rename'), remove: invoke('projects:remove'), close: invoke('projects:close') },
  project: { overview: invoke('project:overview'), sync: invoke('project:sync'), status: invoke('project:status'), files: invoke('project:files'), readFile: invoke('project:read-file'), diagnostics: invoke('project:diagnostics'), backup: invoke('project:backup'), restoreBackup: invoke('project:restore-backup'), openGrafIgnore: invoke('project:open-grafignore') },
  graph: { data: invoke('graph:data'), layout: { get: invoke('graph:layout:get'), save: invoke('graph:layout:save') }, search: invoke('graph:search'), addNode: invoke('graph:node:add'), node: invoke('graph:node'), neighbors: invoke('graph:neighbors'), impact: invoke('graph:impact'), read: invoke('graph:read'), addEdge: invoke('graph:edge:add'), removeEdge: invoke('graph:edge:remove'), setSummary: invoke('graph:node:summary'), setHidden: invoke('graph:node:hidden'), setPinned: invoke('graph:node:pin') },
  tree: { get: invoke('tree:get') },
  usage: { summary: invoke('usage:summary'), all: invoke('usage:all'), clear: invoke('usage:clear') },
  context: { get: invoke('context:get'), save: invoke('context:export') },
  memory: { list: invoke('memory:list'), add: invoke('memory:add'), update: invoke('memory:update'), approve: invoke('memory:approve'), archive: invoke('memory:archive'), delete: invoke('memory:delete') },
  notes: { list: invoke('notes:list'), forNode: invoke('notes:for-node'), add: invoke('notes:add') },
  history: { list: invoke('history:list'), snapshot: invoke('history:snapshot'), diff: invoke('history:diff'), restore: invoke('history:restore') },
  changes: { list: invoke('changes:list') },
  proposals: { list: invoke('proposals:list'), approve: invoke('proposals:approve'), reject: invoke('proposals:reject') },
  integrations: { status: invoke('integrations:status'), configure: invoke('integrations:configure'), manual: invoke('integrations:manual'), commandsStatus: invoke('integrations:commands-status'), commandsInstall: invoke('integrations:commands-install'), commandsRemove: invoke('integrations:commands-remove'), disconnect: invoke('integrations:disconnect'), testRuntime: invoke('integrations:test-runtime'), testMcp: invoke('integrations:test-mcp') },
  exportGraph: invoke('export:graph'),
  openPath: invoke('shell:open-path'),
  revealFile: invoke('shell:reveal-file')
};
contextBridge.exposeInMainWorld('graf', Object.freeze(api));
