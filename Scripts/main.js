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
        let range = new Range(0, editor.document.length);
        let documentText = editor.getTextInRange(range);
        let lintFile = nova.fs.open(nova.extension.path +  "/lintFile.tmp.php", "w");

        lintFile.write(editor.getTextInRange(range));
        lintFile.close();
        this.output = "";

        return new Promise(function (resolve) {
            try {
                if (
                    self.linter !== undefined
                    && self.linter.pid > 0
                ) {
                    if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
                        console.log("Killed previous linter instance.");
                    }

                    self.output = "";
                    self.linter.kill();
                }

                self.linter = new Process('/usr/bin/env', {
                    args: [
                        './Bin/phpmd',
                        `${lintFile.path}`,
                        'json',
                        self.getStandard(),
                    ],
                    shell: true,
                });

                self.linter.onStderr(function (error) {
                    console.error(error);
                });

                self.linter.onStdout(function (line) {
                    self.output = self.output + line;
                });

                self.linter.onDidExit(function () {
                    if (self.output.length > 0) {
                        resolve(self.parseLinterOutput(editor, self.output));
                    }

                    if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
                        console.log(
                            "Finished linting "
                            + editor.document.path
                        );
                    }
                });

                if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
                    console.log(
                        "PHPMD started linting "
                        + editor.document.path
                    );
                    console.log("Running command: " + './Bin/phpmd ' + `${lintFile.path}` + ' json ' + self.getStandard());
                }

                self.linter.start();
            } catch (error) {
                console.error(error);
            }
        });
    }

    parseLinterOutput(editor, output) {
        let self = this;
        let lints = JSON.parse(output);
        let issues = lints.files
            .flatMap(function (lint) {
                return lint.violations;
            })
            .map(function (lint) {
                let code = self.getLineOfCode(editor, lint.beginLine);
                let issue = new Issue();
                let target = lint.function
                    || lint.class
                    || lint.method;

                issue.message = lint.description;
                issue.severity = IssueSeverity.Warning;

                if (lint.priority <= 2) {
                    issue.severity = IssueSeverity.Error;
                }

                issue.line = lint.beginLine;
                issue.code = lint.rule + "| " + lint.ruleSet + " | phpmd";
                issue.endLine = issue.line;
                issue.column = self.getColumn(code, target);
                issue.endColumn = issue.column + target.length;

                if (nova.config.get('genealabs.phpmd.debugging', 'boolean')) {
                    console.log("Found lint:");
                    console.log("===========");
                    console.log("Line Of Code: |" + code + "|");
                    console.log("Line: " + issue.line);
                    console.log("Class: " + lint.class);
                    console.log("Function: " + lint.function);
                    console.log("Method: " + lint.method);
                    console.log("Calculated Start Column: " + issue.column);
                    console.log("Calculated End Column: " + issue.endColumn);
                    console.log("Message: " + lint.description);
                    console.log("Rule: " + lint.rule);
                    console.log("Ruleset: " + lint.ruleSet);
                    console.log("Priority: " + lint.priority);
                    console.log("===========");
                }

                return issue;
            });

        return issues;
    }

    getLineOfCode(editor, lineNumber)
    {
        let range = new Range(0, editor.document.length);
        let documentText = editor.getTextInRange(range);

        return documentText.split("\n")[lineNumber - 1];
    }

    getColumn(haystack, needle)
    {
        return haystack.indexOf(needle) + 1;
    }
}

nova.assistants.registerIssueAssistant("php", new IssuesProvider());
