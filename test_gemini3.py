from html.parser import HTMLParser

class Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_list_depth = 0
        self.links = set()

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag == 'conversations-list' and attrs_dict.get('data-test-id') == 'all-conversations':
            self.in_list_depth += 1
        elif tag == 'a':
            href = attrs_dict.get('href', '')
            if href.startswith('/app/') and self.in_list_depth > 0:
                self.links.add(href)

    def handle_endtag(self, tag):
        if tag == 'conversations-list' and self.in_list_depth > 0:
            self.in_list_depth -= 1

p = Parser()
with open('sidebar/gemini.html', 'r', encoding='utf-8') as f:
    p.feed(f.read())

print("Links inside all-conversations:", len(p.links))
