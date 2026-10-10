-- PowerPoint decks (.pptx) can be uploaded as well as PDFs; the server reads each slide's text.
update storage.buckets
set allowed_mime_types = array['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
where id = 'materials';
