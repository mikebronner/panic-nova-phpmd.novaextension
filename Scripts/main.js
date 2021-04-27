exports.activate = function() {
    if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
        console.log("Extension is activated.");
    }

    var process = new Process("/usr/bin/env", {
        args: ["chmod", "+x", "./Bin/phpmd"],
        shell: true
    });
    process.onStderr(function(line) {console.error(line);});
    process.start();
}

exports.deactivate = function() {
    if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
        console.log("Extension is being deactivated.");
    }
}

class IssuesProvider {
    constructor() {
    }

    getExecutablePath()
    {
        let globalExecutable = nova.config
            .get("genealabs.phpmd.executablePath", "string")
            .trim();
        let projectExecutable = nova.workspace
            .config
            .get("genealabs.phpmd.executablePath", "string")
            .trim();
        let bundledExecutable = nova.path.join(
            nova.extension.path,
            "Bin",
            "phpmd"
        );

        if (
            globalExecutable.length > 0
            && globalExecutable.charAt() !== "/"
        ) {
            globalExecutable = nova.path.join(
                nova.workspace.path,
                globalExecutable
            );
        }

        if (
            projectExecutable.length > 0
            && projectExecutable.charAt() !== "/"
        ) {
            projectExecutable = nova.path.join(
                nova.workspace.path,
                projectExecutable
            );
        }

        let path = projectExecutable
            || globalExecutable
            || bundledExecutable;

        if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
            console.log("Executable Path", path);
        }

        return path;
    }

    getStandard() {
        let customStandard = nova.path.join(nova.workspace.path, "phpmd.xml");
        let projectStandard = nova.workspace.config.get(
            'genealabs.phpmd.standard',
            'string'
        );
        let globalStandard = nova.config.get(
            'genealabs.phpmd.standard',
            'string'
        );
        let defaultStandard = "cleancode,codesize,controversial,design,naming,unusedcode";

        customStandard = nova.fs.stat(customStandard) != undefined
            ? customStandard
            : null;

        let selectedStandard = (((projectStandard || customStandard) || globalStandard) || defaultStandard);

        if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
            console.log("Determined linting standard: " + selectedStandard);
        }

        return selectedStandard;
    }

    provideIssues(editor) {
        let issues = [];
        let self = this;

        return new Promise(function (resolve) {
            let fileName = Math.random().toString(36).substring(2, 15)
                + Math.random().toString(36).substring(2, 15)
                + ".php";
            let range = new Range(0, editor.document.length);
            let documentText = editor.getTextInRange(range);
            let output = "";

            try {
                nova.fs.mkdir(nova.extension.workspaceStoragePath)
            } catch (error) {
                // fail silently
            }

            let lintFile = nova.fs.open(nova.path.join(nova.extension.workspaceStoragePath, fileName), "w");

            lintFile.write(documentText);
            lintFile.close();

            try {
                let linter = new Process('/usr/bin/env', {
                    args: [
                        self.getExecutablePath(),
                        `${lintFile.path}`,
                        'json',
                        self.getStandard(),
                        '--ignore-violations-on-exit',
                    ],
                    shell: true,
                });

                linter.onStdout(function (line) {
                    if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
                        console.log("Linter output:", line);
                    }

                    if (line.indexOf("Deprecated") === 0) {
                        return;
                    }

                    output += line;
                });

                linter.onStderr(function (line) {
                    console.error(line);
                });

                linter.onDidExit(function () {
                    output = output.trim();

                    if (output.length === 0) {
                        return resolve([]);
                    }

                    if (! self.outputIsJson(output)) {
                        console.error(output);

                        return resolve([]);
                    }

                    resolve(self.parseLinterOutput(output));

                    if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
                        console.log("Finished linting.");
                    }

                    nova.fs.remove(lintFile.path);
                });

                if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
                    console.log("Started linting.");
                    console.log(`Running command: ${self.getExecutablePath()} ${lintFile.path} json ${self.getStandard()}`);
                }

                linter.start();
            } catch (error) {
                console.error("error during processing", error);
            }
        });
    }

    outputIsJson(output)
    {
        try {
            return (JSON.parse(output) && !!output);
        } catch (error) {
            return false;
        }
    }

    parseLinterOutput(output) {
        let self = this;
        let lints = JSON.parse(output);
        let issues = lints.files
            .flatMap(function (lint) {
                return lint.violations;
            })
            .map(function (lint) {
                let issue = new Issue();

                issue.message = lint.description;
                issue.severity = IssueSeverity.Error;

                if (lint.priority <= 2) {
                    issue.severity = IssueSeverity.Warning;
                }

                issue.line = lint.beginLine;
                issue.code = lint.rule + "| " + lint.ruleSet + " | phpmd";
                issue.endLine = issue.line + 1;

                if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
                    console.log("Found lint:");
                    console.log("===========");
                    console.log("Line: " + issue.line);
                    console.log("Message: " + issue.message);
                    console.log("Code: " + issue.code);
                    console.log("Ruleset: " + lint.ruleSet);
                    console.log("Severity: " + issue.severity);
                    console.log("===========");
                }

                return issue;
            })
            .filter(function (issue) {
                return issue !== null;
            });

            let errors = (lints.errors || [])
                .map(function (lint) {
                    let issue = new Issue();

                    issue.message = lint.message;
                    issue.severity = IssueSeverity.Error;
                    issue.line = issue.message.match(/^.*? line: (.*?), col: .*$/i)[1];
                    issue.code = "phpmd";
                    issue.endLine = issue.line + 1;

                    if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
                        console.log("Found error lint:");
                        console.log("===========");
                        console.log("Line: " + issue.line);
                        console.log("Message: " + lint.message);
                        console.log("===========");
                    }

                    return issue;
                });

        return issues
            .concat(errors);
    }
}

nova.assistants.registerIssueAssistant("php", new IssuesProvider());
