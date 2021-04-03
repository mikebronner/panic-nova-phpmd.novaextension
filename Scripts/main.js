exports.activate = function() {
    console.log("Extension is activated.");
    var process = new Process("/usr/bin/env", {
        args: ["chmod", "+x", "./Bin/phpmd"],
        shell: true
    });
    process.onStderr(function(line) {console.error(line);});
    process.start();
}

exports.deactivate = function() {
    console.log("Extension is being deactivated.");
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

        return (((projectStandard || customStandard) || globalStandard) || defaultStandard);
    }
    
    provideIssues(editor) {
        let issues = [];
        let self = this;
        let output = "";

        if (editor.document.path === undefined) {
            return;
        }
        
        return new Promise(function (resolve) {
            try {
                const linter = new Process('/usr/bin/env', {
                    args: [
                        './Bin/phpmd',
                        `${editor.document.path}`,
                        'json',
                        self.getStandard(),
                    ],
                    shell: true,
                });
                
                linter.onStderr(function (error) {
                    console.error(error);
                });
                
                linter.onStdout(function (line) {
                    output = output + line;
                });

                linter.onDidExit(function () {
                    if (output.length > 0) {
                        resolve(self.parseLinterOutput(editor, output));
                    }
                    console.log(
                        "PHPMD finished linting "
                        + editor.document.path
                    );
                });

                console.log(
                    "PHPMD started linting "
                    + editor.document.path
                );
                console.log("Running command: " + './Bin/phpmd ' + `${editor.document.path}` + ' json ' + self.getStandard());

                linter.start();
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
            .map(function (violation) {
                let code = self.getLineOfCode(editor, violation.beginLine);
                let issue = new Issue();
                let target = violation.function
                    || violation.class
                    || violation.method;

                issue.message = violation.description;
                issue.severity = IssueSeverity.Warning;
                
                if (violation.priority <= 2) {
                    issue.severity = IssueSeverity.Error;
                }

                issue.line = violation.beginLine;
                issue.code = violation.rule + "| " + violation.ruleSet + " | phpmd";
                issue.endLine = issue.line;
                issue.column = self.getColumn(code, target);
                issue.endColumn = issue.column + target.length;
    
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
