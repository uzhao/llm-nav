import re
from html.parser import HTMLParser

class MyHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_sidenav = 0
        self.links_in_sidenav = set()
        self.links_outside = set()

    def handle_starttag(self, tag, attrs):
        if tag == 'bard-sidenav':
            self.in_sidenav += 1
        elif tag == 'a':
            href = dict(attrs).get('href', '')
            if '/app/' in href:
                match = re.search(r'/app/([a-zA-Z0-9]+)', href)
                if match:
                    path = match.group(0)
                    if self.in_sidenav > 0:
                        self.links_in_sidenav.add(path)
                    else:
                        self.links_outside.add(path)

    def handle_endtag(self, tag):
        if tag == 'bard-sidenav':
            self.in_sidenav -= 1

parser = MyHTMLParser()
with open('sidebar/gemini.html', 'r', encoding='utf-8') as f:
    parser.feed(f.read())

print("In sidenav:", len(parser.links_in_sidenav))
print("Outside sidenav:", len(parser.links_outside))
