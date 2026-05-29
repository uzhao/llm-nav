from html.parser import HTMLParser

class Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sidenavs = []
        self.current_sidenav_index = -1
        self.in_sidenav_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == 'bard-sidenav':
            if self.in_sidenav_depth == 0:
                self.sidenavs.append({'links': set()})
                self.current_sidenav_index += 1
            self.in_sidenav_depth += 1
        elif tag == 'a':
            href = dict(attrs).get('href', '')
            if href.startswith('/app/'):
                if self.in_sidenav_depth > 0:
                    self.sidenavs[self.current_sidenav_index]['links'].add(href)

    def handle_endtag(self, tag):
        if tag == 'bard-sidenav':
            self.in_sidenav_depth -= 1

p = Parser()
with open('sidebar/gemini.html', 'r', encoding='utf-8') as f:
    p.feed(f.read())

print("Total sidenavs:", len(p.sidenavs))
for i, s in enumerate(p.sidenavs):
    print(f"Sidenav {i} links:", len(s['links']))

