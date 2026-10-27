# Diff Fixtures

These files are the unedited output of `git diff --no-color --find-renames --src-prefix=a/ --dst-prefix=b/ <base> <head>`, run in temporary repos made with git 2.50.1 (Apple Git-155). They use the default context, so hunks have context lines. The content is small, made-up, SauceDemo style code and text.

Do not edit these files by hand. The parser tests read their expected values from these exact bytes. To change a fixture, build a new temporary repo and save the new git output. `.gitattributes` marks the files `-text` so a checkout never changes their line endings.

## Fixtures

| File | Scenario |
| --- | --- |
| `add.diff` | One new file: `demo/saucedemo/pages/wishlist-page.ts` |
| `modify.diff` | One modified file, `demo/saucedemo/pages/cart-page.ts`, in one hunk with context lines |
| `delete.diff` | One deleted file: `docs/old-notes.md` |
| `rename.diff` | A pure rename with no hunks: `demo/saucedemo/pages/cart-page.ts` to `demo/saucedemo/pages/basket-page.ts` |
| `rename-with-edits.diff` | A rename with a few changed lines in two hunks: `demo/saucedemo/pages/checkout-page.ts` to `demo/saucedemo/pages/order-page.ts` |
| `binary.diff` | A new binary file `docs/logo.png` and a modified binary file `docs/banner.png` |
| `spaces-in-path.diff` | Paths with spaces: added `docs/release notes.md`, modified `docs/my folder/team notes.md`, renamed `docs/old name.md` to `docs/new name.md` |
| `multiple-hunks.diff` | One file with three hunks: one only adds lines, one only deletes lines, one changes a line |
| `no-newline.diff` | The last line changes and neither version ends with a newline, so `\ No newline at end of file` appears twice |
| `content-looks-like-headers.diff` | A removed line `-- old note` and an added line `++ new note`, shown in the diff as `--- old note` and `+++ new note` |
| `mixed.diff` | Ten modified files, one for each file class |
| `empty.diff` | Zero bytes: the diff of two commits with identical trees |
