/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export const instructions = `## Document Result
<widget:document-result name="filename.pdf" fileId="uuid-or-attachment-uri" snippet="relevant text excerpt" score="0.95" />
Shows a source document card with file name and content snippet.
Haystack: fileId is a remote document id.
ZeroClaw: after deliver_file, fileId must be the exact returned uri (attachment://deliver/<basename>); name= comes from [Document: …], not from inventing ACP filename.`
